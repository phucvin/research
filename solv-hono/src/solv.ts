import {
    CommandMap,
    CreateElement,
    Id,
    StaticId,
    UpdateElement,
    ELEMENT_ID_PREFIX,
    SIGNAL_ID_PREFIX,
    HasId,
    Solv,
    AddEffect
} from "./shared";
import ssr from "./ssr";
import * as cache from "./cache";
import { getServerHandler, getHandler } from "./registry";
import { Hono } from "hono";
import { serveStatic } from '@hono/node-server/serve-static'
import { readFileSync } from 'fs';
import path from 'path';

function numberToId(prefix: string, x: number) {
    if (x < 0) {
        return `${prefix}@${-x}`;
    } else {
        return `${prefix}_${x}`;
    }
}

function toIds(xs: (HasId | Id)[]) {
    const ids: Id[] = [];
    for (const x of xs) {
        ids.push(typeof x === 'string' ? x : x?.id);
    }
    return ids;
}

function initUpdateElements(cm: CommandMap, id: Id) {
    if (!cm.updateElements) {
        cm.updateElements = {};
    }
    if (!cm.updateElements[id]) {
        cm.updateElements[id] = {
            sets: undefined,
            children: undefined,
        };
    }
}

function createSolv(signals: { [id: Id]: any }, cm: CommandMap) {
    const solv: Solv = {
        newElement: (tag: string) => {
            const id = numberToId(ELEMENT_ID_PREFIX, cm.nextNumber!++);
            if (!cm.createElements) {
                cm.createElements = [];
            }
            cm.createElements.push({ id, tag });
            return solv.getElement(id);
        },
        newSignal: (initialValue: any) => {
            const id = numberToId(SIGNAL_ID_PREFIX, cm.nextNumber!++);
            signals[id] = initialValue;
            if (!cm.setSignals) {
                cm.setSignals = {};
            }
            cm.setSignals[id] = initialValue;
            return solv.getSignal(id);
        },
        getElement: (id: Id) => {
            return {
                id,
                set: (name: string, value: any) => {
                    initUpdateElements(cm, id);
                    if (!cm.updateElements![id].sets) {
                        cm.updateElements![id].sets = {};
                    }
                    cm.updateElements![id]!.sets![name] = value;
                },
                setChildren: (children: (HasId | Id)[]) => {
                    initUpdateElements(cm, id);
                    cm.updateElements![id]!.children = toIds(children);
                },
            };
        },
        getSignal: (id: Id) => {
            return {
                id,
                get: () => signals[id],
                set: (newValue: any) => {
                    signals[id] = newValue;
                    if (!cm.setSignals) {
                        cm.setSignals = {};
                    }
                    cm.setSignals[id] = newValue;
                    if (!cm.pendingSignals) {
                        cm.pendingSignals = {};
                    }
                    cm.pendingSignals[id] = (cm.pendingSignals[id] || 0) + 1;
                },
            }
        },
        addEffect: (handler: StaticId, params: any[]) => {
            if (!cm.addEffects) {
                cm.addEffects = [];
            }
            cm.addEffects.push({ handler, params });
        }
    };
    return solv;
}

async function runAddedEffects(cm: CommandMap, solv: Solv) {
    for (const addEffect of cm.addEffects || []) {
        let handler = getServerHandler(addEffect.handler);
        if (!handler) {
            handler = getHandler(addEffect.handler);
        }
        if (!handler) {
            throw new Error(`Handler not found whie processing added effects: ${addEffect.handler}`);
        }
        let params: any = [...addEffect.params];
        params.push(solv);
        await handler(...params);
    }
}

function createCommandMap(nextNumber: number) {
    const cm: CommandMap = {
        nextNumber,
        createElements: undefined,
        updateElements: undefined,
        deleteElements: undefined,
        setSignals: undefined,
        addEffects: undefined,
        pendingSignals: undefined,
    };
    return cm;
}

function applyCommandMap(cm: CommandMap, signals: { [id: Id]: any }) {
    if (!cm.nextNumber) {
        throw new Error('Missing nextNumber in command map');
    }
    for (const [id, value] of Object.entries(cm.setSignals || {})) {
        signals[id] = value;
    }
    cm = createCommandMap(cm.nextNumber);
    return cm;
}

export function createSolvApp(appLogic: (solv: Solv) => Promise<void>) {
    const app = new Hono();

    app.get('/', async (c) => {
        const signals: { [id: Id]: any } = {};
        const cm = createCommandMap(1);
        const solv = createSolv(signals, cm);

        await appLogic(solv);
        await runAddedEffects(cm, solv);

        const cid = await cache.insert({
            signals,
            effects: cm.addEffects,
            nextNumber: cm.nextNumber,
        });

        const html = ssr(cid, cm);
        return c.html(html);
    });

    app.post('/action', async (c) => {
        const action = await c.req.json();
        const cid = action.cid;
        if (cid === undefined) {
            return c.json({ 'error': 'Missing CID' }, 400);
        }

        const handler = getServerHandler(action.handler);
        if (!handler) {
            return c.json({ 'error': `Handler not found: ${action.handler}` }, 400);
        }

        let { signals, effects, nextNumber } = action.client || {};
        // Get from cache if client didn't send current state
        if (!(signals && effects)) {
            let data: any;
            try {
                data = await cache.get(cid);
            } catch (err) {
                return c.json({ 'error': `Cache not found for cid: ${cid}` }, 404);
            }
            ({ signals, effects, nextNumber } = data);

            if (!signals) {
                 return c.json({ 'error': 'Internal error: Missing signals in cache' }, 500);
            }
        }

        let cm;
        try {
            cm = applyCommandMap(action.cm, signals);
        } catch (err) {
            console.error('Error procesing command map', err);
            return c.json({ 'error': 'Error processing command map' }, 400);
        }

        const solv = createSolv(signals, cm);
        const params = [...action.params];
        params.push(solv);
        await handler(...params);

        await cache.update(cid, {
            signals,
            effects: effects ? effects.concat(cm.addEffects || []) : cm.addEffects,
            nextNumber: cm.nextNumber,
        });

        c.header('Content-Type', 'application/json');
        return c.body(`|>${JSON.stringify(cm)}<|`);
    });

    // Serve client.mjs
    app.get('/client.mjs', async (c) => {
        const clientContent = readFileSync(path.join(process.cwd(), 'src/client.js'), 'utf-8');
        return c.body(clientContent, 200, { 'Content-Type': 'application/javascript' });
    });

    return app;
}

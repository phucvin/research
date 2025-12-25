// The original client.ts is TypeScript, but it needs to be transpiled to JS to be served.
// Since we are running node, we can't easily serve the TS file directly for the browser.
// However, the prompt asks to reimplement using Hono.
// The easiest way is to copy the client logic to a JS file that can be served.
// Since the original repo builds it using mjscjs, we should try to adapt it.

// But wait, the client.ts imports shared.ts and registry.ts.
// We need to bundle these or serve them as modules.
// For simplicity, I'll bundle them into a single file or just copy the logic manually since it's "basic version".

// Actually, I can use esbuild or similar if available, but I don't want to overcomplicate the build.
// I will create a simple `client.js` in `src` that contains the necessary logic from `client.ts`, `shared.ts`, and `registry.ts`.

// Wait, I can't just copy paste TS code into JS file. I need to strip types.
// I'll manually create a JS version of the client code.

const ACTION_HANDLER_STATIC_ID_PREFIX = 'a_';
const SERVER_ACTION_HANDLER_STATIC_ID_PREFIX = 'A_';
const EFFECT_HANDLER_STATIC_ID_PREFIX = 'e_';
const SERVER_EFFECT_HANDLER_STATIC_ID_PREFIX = 'E_';
const SIGNAL_ID_PREFIX = 's';
const ELEMENT_ID_PREFIX = 'n';
const DOCUMENT = '$document';
const BODY = '$body';

const seenStaticIds = new Set();
let serverHandlers = {};
let handlers = {};

function addStaticId(staticId) {
    if (seenStaticIds.has(staticId)) {
        throw new Error(`Duplicate Static ID: ${staticId}`);
    }
    seenStaticIds.add(staticId);
}

export function registerServerActionHandler(staticId, handler) {
    staticId = `${SERVER_ACTION_HANDLER_STATIC_ID_PREFIX}${staticId}`;
    addStaticId(staticId);
    serverHandlers[staticId] = handler;
    return staticId;
}

export function registerServerEffectHandler(staticId, handler) {
    staticId = `${SERVER_EFFECT_HANDLER_STATIC_ID_PREFIX}${staticId}`;
    addStaticId(staticId);
    serverHandlers[staticId] = handler;
    return staticId;
}

export function getServerHandler(staticId) {
    return serverHandlers[staticId];
}

export function registerActionHandler(staticId, handler) {
    staticId = `${ACTION_HANDLER_STATIC_ID_PREFIX}${staticId}`;
    addStaticId(staticId);
    handlers[staticId] = handler;
    return staticId;
}

export function registerEffectHandler(staticId, handler) {
    staticId = `${EFFECT_HANDLER_STATIC_ID_PREFIX}${staticId}`;
    addStaticId(staticId);
    handlers[staticId] = handler;
    return staticId;
}

export function getHandler(staticId) {
    return handlers[staticId];
}

export function isServerHandler(staticId) {
    return staticId.startsWith(SERVER_ACTION_HANDLER_STATIC_ID_PREFIX) ||
        staticId.startsWith(SERVER_EFFECT_HANDLER_STATIC_ID_PREFIX);
}

export function isSignal(id) {
    return id.startsWith(SIGNAL_ID_PREFIX);
}

// Client's all signals and effects
const signals = {};
const effects = [];
const effectMap = {};

let lcm;
const tempElementMap = new Map();

function createElement(id, tag) {
    const node = document.createElement(tag);
    node.id = id;
    tempElementMap.set(id, node);
}

function findElementById(id) {
    switch (id) {
        case DOCUMENT: return document;
        case BODY: return document.body;
    }

    const node = document.getElementById(id);
    if (node) {
        return node;
    }
    return tempElementMap.get(id);
}

function applyElementUpdate(id, update) {
    let node = findElementById(id);
    if (!node) {
        console.error(`Node not found: ${id}`);
        return;
    }
    for (const [name, value] of Object.entries(update.sets || {})) {
        if (value === null) {
            node[name] = undefined;
            if (node.removeAttribute) {
                node.removeAttribute(name);
            }
        } else if (name.startsWith('on')) {
            let code = '';
            for (const action of (Array.isArray(value) ? value : [value])) {
                code += `solv.dispatch(${JSON.stringify(action)});`;
            }
            node.setAttribute(name, code);
        } else {
            node[name] = value;
            if (node.setAttribute) {
                node.setAttribute(name, value);
            }
        }
    }
    if (update.children) {
        let childNodes = [];
        const childrenToRemove = new Set(node.children);
        for (const childId of update.children) {
            const child = findElementById(childId);
            if (child) {
                childNodes.push(child);
                childrenToRemove.delete(child);
            }
        }
        for (const childToRemove of childrenToRemove) {
            childToRemove.remove();
        }
        childNodes.forEach((element, index) => {
            const currentChild = node.children[index];
            if (currentChild !== element) {
                node.insertBefore(element, currentChild || null);
            }
        });
    }
}

async function runAddedEffects(cm, solv) {
    for (const addEffect of cm.addEffects || []) {
        let handler = getHandler(addEffect.handler);
        if (!handler) {
            throw new Error(`Unimplemented executing server effect handler: ${addEffect.handler}`);
        }
        let params = [...addEffect.params];
        params.push(solv);
        await handler(...params);
    }
}

async function applyCommandMap(cm) {
    for (const ce of cm.createElements || []) {
        createElement(ce.id, ce.tag);
    }
    for (const [id, update] of Object.entries(cm.updateElements || {})) {
        applyElementUpdate(id, update);
    }
    for (const id of cm.deleteElements || []) {
        document.getElementById(id)?.remove();
    }
    for (const [id, value] of Object.entries(cm.setSignals || {})) {
        signals[id] = value;
    }
    if (cm.addEffects) {
        effects.push(...cm.addEffects);
        for (const addEffect of cm.addEffects || []) {
            for (const paramId of addEffect.params) {
                if (isSignal(paramId)) {
                    if (!effectMap[paramId]) {
                        effectMap[paramId] = [];
                    }
                    effectMap[paramId].push(addEffect);
                }
            }
        }
    }
    await runAddedEffects(cm, solv);

    lcm = {
        nextNumber: cm.nextNumber,
        createElements: undefined,
        updateElements: undefined,
        deleteElements: undefined,
        setSignals: undefined,
        addEffects: undefined,
        pendingSignals: cm.pendingSignals,
    };
}

function numberToId(x) {
    if (x < 0) {
        return `@${-x}`;
    } else {
        return `_${x}`;
    }
}

function toIds(xs) {
    const ids = [];
    for (const x of xs) {
        ids.push(typeof x === 'string' ? x : x?.id);
    }
    return ids;
}

const solv = {
    newElement: (tag) => {
        if (lcm.nextNumber === undefined) {
            throw new Error('Local Command Map is not ready');
        }
        const id = numberToId(lcm.nextNumber++);
        createElement(id, tag);
        return solv.getElement(id);
    },
    newSignal: (initialValue) => {
        if (lcm.nextNumber === undefined) {
            throw new Error('Local Command Map is not ready');
        }
        const id = numberToId(lcm.nextNumber++);
        const signal = solv.getSignal(id);
        signal.set(initialValue);
        return signal;
    },
    getElement: (id) => {
        return {
            id,
            set: (name, value) => {
                applyElementUpdate(id, { sets: { [name]: value }, children: undefined });
            },
            setChildren: (children) => {
                applyElementUpdate(id, { sets: undefined, children: toIds(children) });
            },
        };
    },
    getSignal: (id) => {
        return {
            id,
            get: () => signals[id],
            set: (newValue) => {
                signals[id] = newValue;
                if (!lcm.pendingSignals) {
                    lcm.pendingSignals = {};
                }
                lcm.pendingSignals[id] = (lcm.pendingSignals[id] || 0) + 1;
                if (!lcm.setSignals) {
                    lcm.setSignals = {};
                }
                lcm.setSignals[id] = newValue;
            },
        }
    },
    addEffect: (handler, params) => {
        const addEffect = { handler, params };
        if (!lcm.addEffects) {
            lcm.addEffects = []
        }
        lcm.addEffects.push(addEffect);

        effects.push(addEffect);
        for (const paramId of params) {
            if (isSignal(paramId)) {
                if (!effectMap[paramId]) {
                    effectMap[paramId] = [];
                }
                effectMap[paramId].push(addEffect);
            }
        }
    }
};

async function resolvePendingSignals() {
    let repeats = 5;
    while (Object.keys(lcm.pendingSignals || {}).length > 0 && --repeats > 0) {
        const pendingSignals = lcm.pendingSignals || {};
        lcm.pendingSignals = undefined;
        for (const signalId in pendingSignals) {
            for (const effect of effectMap[signalId] || []) {
                let handler = getHandler(effect.handler);
                if (handler) {
                    const params = [...effect.params];
                    params.push(solv);
                    await handler(...params);
                } else {
                    throw new Error(
                        `Unimplemented executing server effect handler: ${effect.handler}`);
                }
            }
        }
    }
    if (repeats <= 0) {
        throw new Error('Too many repeats processing pending signals');
    }
    tempElementMap.clear();
}

async function dispatchServer(action, resend = false) {
    const body = JSON.stringify({
        cid: SOLV_CID,
        cm: lcm,
        client: resend ? { signals, effects } : undefined,
        ...action
    });
    console.log('dispatchServer', body);
    const res = await fetch('/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    if (res.status == 404 && resend == false) {
        console.log('Server lost cache, resending client state');
        return dispatchServer(action, resend = true);
    }
    if (!res.ok) {
        console.error('Dispatch response error', res.statusText);
        return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let result = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        const chunk = decoder.decode(value, { stream: true });
        result += chunk;
        const CHUNK_BEGIN = '|>';
        const CHUNK_END = '<|';
        let chunkEndIdx = result.indexOf(CHUNK_END);
        while (chunkEndIdx >= 0) {
            // console.assert(result.startsWith(CHUNK_BEGIN));

            const cm = JSON.parse(result.substring(CHUNK_BEGIN.length, chunkEndIdx));
            console.log('cm', JSON.stringify(cm));
            await applyCommandMap(cm);

            result = result.substring(chunkEndIdx + CHUNK_END.length);
            // Find next chunk
            chunkEndIdx = result.indexOf(CHUNK_END);
        }
    }
}

async function dispatchRaw(action) {
    let params = [...action.params];
    params.push(solv);
    const handler = getHandler(action.handler);
    if (handler) {
        await handler(...params);
    } else { // Server action handler
        await dispatchServer(action);
    }
    await resolvePendingSignals();
}

let lastDispatch = Promise.resolve();

async function dispatch(action) {
    // Queue dispatch to avoid dispatching while processing previous response stream
    await lastDispatch;
    lastDispatch = dispatchRaw(action);
}

globalThis.solv = {
    applyCommandMap,
    dispatch,
    signals,
    effectMap,
};

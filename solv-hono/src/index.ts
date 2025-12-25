import { serve } from '@hono/node-server';
import { createSolvApp } from './solv';
import { Solv, BODY, DOCUMENT } from './shared';
import { registerServerActionHandler } from './registry';

// Define the application logic
async function app(solv: Solv) {
    const document = solv.getElement(DOCUMENT);
    document.set('title', 'Solv Hono App');

    const body = solv.getElement(BODY);

    const title = solv.newElement('h1');
    title.set('innerHTML', 'Hello World from Solv + Hono!');
    title.set('class', 'text-3xl font-bold underline mb-4');

    const counter = solv.newSignal(0);

    const counterDisplay = solv.newElement('div');
    counterDisplay.set('innerHTML', `Counter: ${counter.get()}`);
    counterDisplay.set('class', 'mb-2');

    // Define a server action handler
    const increment = registerServerActionHandler('increment', async (c: any, s: Solv) => {
        // c is the signal passed from client, s is the solv instance on server
        // But wait, the signal passed is just a string ID. We need to get the signal object.
        const signal = s.getSignal(c.id);
        const newValue = signal.get() + 1;
        signal.set(newValue);

        // We need to update the display too, but how?
        // In the original solv, we need to know the ID of the display element or pass it.
        // Or we can assume the display element is updated by an effect?
        // Let's keep it simple: just update the signal.
        // Wait, if I update the signal, does it automatically update the DOM?
        // Only if there is an effect or binding.
        // In the original example, how is it done?
    });

    // We need an effect or something to update the display when signal changes?
    // The original solv example I saw didn't show this part clearly in my `cat` output.
    // Let's checking `index.ts` again.

    /*
    From index.ts:
    const count = solv.newSignal(0);
    ...
    solv.addEffect(updateCount, [count, text]);
    */

    // Ah, so we need a client-side effect to update the DOM when signal changes.
    // But `registerServerActionHandler` is for server actions.
    // If we want to update the DOM from server, we just modify the elements in the handler.
    // But we don't have reference to `counterDisplay` inside the handler unless we pass it.

    // Let's pass the counterDisplay ID to the handler.
    const incrementHandler = registerServerActionHandler('incrementHandler', async (countId: string, displayId: string, s: Solv) => {
        const countSignal = s.getSignal(countId);
        const newVal = countSignal.get() + 1;
        countSignal.set(newVal);

        const display = s.getElement(displayId);
        display.set('innerHTML', `Counter: ${newVal}`);
    });


    const button = solv.newElement('button');
    button.set('innerHTML', 'Increment');
    button.set('class', 'px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600');
    // Set the click handler to call the server action
    button.set('onclick', {
        handler: incrementHandler,
        params: [counter.id, counterDisplay.id]
    });

    body.setChildren([title, counterDisplay, button]);
}

const honoApp = createSolvApp(app);

console.log('Server running on http://localhost:3000');
serve({
    fetch: honoApp.fetch,
    port: 3000
});

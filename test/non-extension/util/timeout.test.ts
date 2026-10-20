// withTimeout: resolves with the wrapped value, rejects with a labelled message when the
// promise stays pending past the limit, and passes through the promise's own rejection.
import { withTimeout } from '../../../src/util/timeout';

describe('withTimeout', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    test('resolves with the value when the promise settles first', async () => {
        jest.useFakeTimers();

        await expect(withTimeout(Promise.resolve('ok'), 1000, 'Job')).resolves.toBe('ok');
        expect(jest.getTimerCount()).toBe(0);
    });

    test('rejects with the label and limit when the promise does not settle in time', async () => {
        jest.useFakeTimers();
        const pending = withTimeout(new Promise<string>(() => undefined), 30000, 'Job');
        const assertion = expect(pending).rejects.toThrow('Job timed out after 30 s');

        jest.advanceTimersByTime(30000);

        await assertion;
    });

    test('passes through a rejection from the promise', async () => {
        jest.useFakeTimers();

        await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'Job')).rejects.toThrow('boom');
        expect(jest.getTimerCount()).toBe(0);
    });
});

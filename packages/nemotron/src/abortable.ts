export async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    // Observe the operation even if it aborted synchronously before reaching us.
    // Its eventual rejection must not become an unhandled background failure.
    if (signal.aborted) {
        void promise.catch(() => { });
        signal.throwIfAborted();
    }
    let listener: () => void = () => { };
    try {
        return await Promise.race([promise, new Promise<never>((_, reject) => {
            listener = () => reject(new Error('job_aborted'));
            signal.addEventListener('abort', listener, { once: true });
        })]);
    }
    finally {
        signal.removeEventListener('abort', listener);
    }
}

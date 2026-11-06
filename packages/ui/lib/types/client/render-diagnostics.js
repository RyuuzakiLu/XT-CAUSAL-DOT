export function observeRenderErrors() {
    window.dotRenderErrors = [];
    const capture = (event) => { window.dotRenderErrors?.push(`${event.message}\n${event.error instanceof Error ? event.error.stack ?? '' : ''}`); if ((window.dotRenderErrors?.length ?? 0) > 10)
        window.dotRenderErrors?.shift(); };
    window.addEventListener('error', capture);
    return () => { window.removeEventListener('error', capture); delete window.dotRenderErrors; };
}

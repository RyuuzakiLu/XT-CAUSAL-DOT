import { useLayoutEffect, useRef } from 'react';
export function useTabMarker(value) {
    const bar = useRef(null);
    useLayoutEffect(() => {
        const root = bar.current;
        if (!root)
            return;
        const selected = root.querySelector('[aria-selected="true"], [role="radio"][aria-checked="true"]');
        if (!selected)
            return;
        const measure = () => {
            root.style.setProperty('--tab-start', selected.offsetLeft + 'px');
            root.style.setProperty('--tab-width', selected.offsetWidth + 'px');
        };
        measure();
        if (typeof ResizeObserver === 'undefined')
            return;
        const observer = new ResizeObserver(measure);
        root.querySelectorAll('button').forEach(button => observer.observe(button));
        return () => observer.disconnect();
    }, [value]);
    return bar;
}

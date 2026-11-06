import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { consumeLoginBoot } from "./login-boot.js";
import css from './lite.module.css';
/** Login-only decoration. The real shell keeps loading behind it; failures never block access. */
export function LiteBoot({ ready, reducedMotion, onStart }) {
    const [active, setActive] = useState(false);
    const [finalFrame, setFinalFrame] = useState(false);
    const [finished, setFinished] = useState(false);
    const [leaving, setLeaving] = useState(false);
    const [systemReduced, setSystemReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    const checked = useRef(false);
    const video = useRef(null);
    const button = useRef(null);
    const still = reducedMotion || systemReduced;
    // Effect (not a state initializer) so React StrictMode's double render cannot eat the hint.
    useLayoutEffect(() => {
        if (checked.current)
            return;
        checked.current = true;
        if (window.__dotLoginBoot) {
            if (window.__dotLoginBoot.claim())
                onStart?.();
            return;
        }
        const pending = consumeLoginBoot();
        setActive(pending);
        if (pending)
            onStart?.();
    }, []);
    useEffect(() => { window.__dotLoginBoot?.update(ready, still); }, [ready, still]);
    useEffect(() => {
        const query = matchMedia('(prefers-reduced-motion: reduce)');
        const changed = () => setSystemReduced(query.matches);
        query.addEventListener('change', changed);
        return () => query.removeEventListener('change', changed);
    }, []);
    useEffect(() => {
        if (!active)
            return;
        const previous = document.activeElement;
        button.current?.focus({ preventScroll: true });
        // Independent of media events and readiness: network/media errors must not trap the app.
        const watchdog = setTimeout(() => setLeaving(true), 10_000);
        const hideOnHistory = () => { setActive(false); };
        window.addEventListener('pagehide', hideOnHistory);
        return () => {
            clearTimeout(watchdog);
            window.removeEventListener('pagehide', hideOnHistory);
            if (previous instanceof HTMLElement && previous.isConnected)
                previous.focus({ preventScroll: true });
        };
    }, [active]);
    useEffect(() => {
        if (!active || !still)
            return;
        const media = video.current;
        media?.pause();
        if (media && Number.isFinite(media.duration))
            media.currentTime = Math.max(0, media.duration - .05);
        setFinalFrame(true);
        const timer = setTimeout(() => setFinished(true), 600);
        return () => clearTimeout(timer);
    }, [active, still]);
    useEffect(() => {
        if (!active || still)
            return;
        const element = video.current;
        if (!element)
            return;
        // A rejected autoplay promise (including Safari restrictions) uses the static ending instead.
        void element.play()?.catch(() => { setFinalFrame(true); setFinished(true); });
        return () => { element.pause(); };
    }, [active, still]);
    useEffect(() => { if (active && finished && ready)
        setLeaving(true); }, [active, finished, ready]);
    useEffect(() => {
        if (!leaving)
            return;
        const timer = setTimeout(() => setActive(false), still ? 0 : 280);
        return () => clearTimeout(timer);
    }, [leaving, still]);
    if (!active)
        return null;
    return _jsxs("button", { type: "button", ref: button, className: css.loginBoot, "data-final": finalFrame || still, "data-leaving": leaving, "data-still": still, "aria-label": "\u6B63\u5728\u8FDB\u5165\u4F60\u7684\u7A7A\u95F4\uFF0C\u70B9\u51FB\u8DF3\u8FC7\u542F\u52A8\u52A8\u753B", onClick: () => setLeaving(true), onKeyDown: event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setLeaving(true);
            }
            if (event.key === 'Tab')
                event.preventDefault();
        }, children: [_jsx("video", { ref: video, className: css.loginBootVideo, src: "/_dot/assets/boot.mp4", muted: true, playsInline: true, preload: "auto", "aria-hidden": "true", tabIndex: -1, onLoadedMetadata: event => {
                    if (still && Number.isFinite(event.currentTarget.duration)) {
                        // Seek without playing: reduced motion shows only the existing video's final frame.
                        event.currentTarget.currentTime = Math.max(0, event.currentTarget.duration - .05);
                    }
                }, onTimeUpdate: event => {
                    const media = event.currentTarget;
                    if (media.currentTime >= (Number.isFinite(media.duration) ? media.duration : 5) - .6)
                        setFinalFrame(true);
                }, onEnded: () => { setFinalFrame(true); setFinished(true); }, onError: () => { setFinalFrame(true); setFinished(true); } }), _jsxs("span", { className: css.loginBootEnd, "aria-hidden": "true", children: [_jsx("img", { src: "/_dot/assets/dot-logo-dark.webp", alt: "" }), _jsx("strong", { children: "XT CAUSAL DOT" }), _jsx("span", { children: "\u6B63\u5728\u8FDB\u5165\u4F60\u7684\u7A7A\u95F4\u2026" }), _jsx("i", { className: css.loginBootProgress })] }), _jsx("span", { className: css.loginBootSkip, "aria-hidden": "true", children: "\u70B9\u51FB\u8DF3\u8FC7" })] });
}

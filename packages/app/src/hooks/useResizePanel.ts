import { useRef, useCallback } from "react";

interface UseResizePanelOptions {
    horizontal: boolean;
    panelRef: React.RefObject<HTMLElement | null>;
    containerRef: React.RefObject<HTMLElement | null>;
    onResize: (size: number) => void;
}

/**
 * Shared drag-to-resize logic for split panels.
 * Returns { borderRef, handleMouseDown, handleTouchStart } to wire onto the resize border element.
 */
export function useResizePanel({ horizontal, panelRef, containerRef, onResize }: UseResizePanelOptions) {
    const dragRef = useRef<{ startPos: number; startSize: number } | null>(null);
    const borderRef = useRef<HTMLDivElement>(null);

    const onDragMove = useCallback((clientPos: number) => {
        if (!dragRef.current || !containerRef.current) return;
        const containerRect = containerRef.current.getBoundingClientRect();
        const delta = clientPos - dragRef.current.startPos;
        const maxSize = horizontal ? containerRect.width - 60 : containerRect.height - 60;
        const newSize = Math.max(60, Math.min(dragRef.current.startSize + delta, maxSize));
        onResize(newSize);
    }, [horizontal, containerRef, onResize]);

    const onDragEnd = useCallback(() => {
        dragRef.current = null;
        borderRef.current?.classList.remove("dragging");
    }, []);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        borderRef.current?.classList.add("dragging");
        const pos = horizontal ? e.clientX : e.clientY;
        const rect = panelRef.current!.getBoundingClientRect();
        dragRef.current = { startPos: pos, startSize: horizontal ? rect.width : rect.height };
        const onMove = (ev: MouseEvent) => onDragMove(horizontal ? ev.clientX : ev.clientY);
        const onUp = () => { onDragEnd(); window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }, [horizontal, panelRef, onDragMove, onDragEnd]);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        const touch = e.touches[0];
        borderRef.current?.classList.add("dragging");
        const pos = horizontal ? touch.clientX : touch.clientY;
        const rect = panelRef.current!.getBoundingClientRect();
        dragRef.current = { startPos: pos, startSize: horizontal ? rect.width : rect.height };
        const onMove = (ev: TouchEvent) => { ev.preventDefault(); onDragMove(horizontal ? ev.touches[0].clientX : ev.touches[0].clientY); };
        const onUp = () => { onDragEnd(); window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onUp); };
        window.addEventListener("touchmove", onMove, { passive: false });
        window.addEventListener("touchend", onUp);
    }, [horizontal, panelRef, onDragMove, onDragEnd]);

    return { borderRef, handleMouseDown, handleTouchStart };
}

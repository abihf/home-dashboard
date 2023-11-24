import { HTMLProps, TouchEventHandler, useCallback, useImperativeHandle, useRef } from "react";

export const enum SwipeDir {
  LEFT = -1,
  RIGHT = 1,
}

export type OnSwipe = (dir: SwipeDir) => void;

interface Props extends HTMLProps<HTMLDivElement> {
  onSwipe: OnSwipe;
}

export function Swipable({ onSwipe, children, ...props }: Props) {
  const startPos = useRef<{ x: number; y: number }>();
  const onTouchStart = useCallback<TouchEventHandler>((ev) => {
    if (ev.targetTouches.length !== 1) {
      return ev.preventDefault();
    }
    const { pageX, pageY } = ev.targetTouches.item(0);
    startPos.current = { x: pageX, y: pageY };
  }, []);

  const onTouchEnd = useCallback<TouchEventHandler>(
    (ev) => {
      if (!startPos.current || ev.changedTouches.length !== 1) return;
      const { pageX, pageY } = ev.changedTouches.item(0);
      const deltaX = startPos.current.x - pageX;
      const deltaY = startPos.current.y - pageY;

      if (Math.abs(deltaY) > Math.abs(deltaX)) return;
      if (deltaX < 5) onSwipe(SwipeDir.LEFT);
      if (deltaX > 5) onSwipe(SwipeDir.RIGHT);
    },
    [onSwipe]
  );
  return (
    <div {...props} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {children}
    </div>
  );
}

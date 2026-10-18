import { useEffect, useState } from 'react';

/** The window's size, updated at most once per frame while it is being resized. */
export function useViewport(): { w: number; h: number } {
  const read = () => ({ w: window.innerWidth || 1280, h: window.innerHeight || 800 });
  const [size, setSize] = useState(read);
  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setSize((old) => {
          const next = read();
          return next.w === old.w && next.h === old.h ? old : next;
        });
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return size;
}

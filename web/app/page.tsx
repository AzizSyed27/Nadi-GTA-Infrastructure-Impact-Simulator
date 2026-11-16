'use client';

import { useEffect } from 'react';

// V2.8 C1 - the route move. `/` belongs to the landing page (it lands in C3); until then this
// route only FORWARDS to the shell at /app/, query intact. The forward of a `?run=` /
// `?compare=` deep link is PERMANENT (the README's published stops and every link shared
// before the move must keep working) - the landing keeps it when it takes this file over.
export default function Root() {
  useEffect(() => {
    window.location.replace(`/app/${window.location.search}`);
  }, []);
  return null;
}

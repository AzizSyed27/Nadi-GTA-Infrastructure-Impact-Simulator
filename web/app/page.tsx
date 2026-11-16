import Landing from '@/components/landing/Landing';

// V2.8: `/` is the landing page - the first thing a visitor sees. The four-stage shell lives
// at /app/ (app/app/page.tsx). The landing forwards a pre-V2.8 deep link (/?run=...) there.
export default function Home() {
  return <Landing />;
}

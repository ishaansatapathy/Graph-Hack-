import { Nav } from "@/components/landing/Nav";
import { Hero } from "@/components/landing/Hero";
import { Problem } from "@/components/landing/Problem";
import { HowItSees } from "@/components/landing/HowItSees";
import { Features } from "@/components/landing/Features";
import { Footer } from "@/components/landing/Footer";
import { SmoothScroll } from "@/components/landing/SmoothScroll";

export default function Home() {
  return (
    <div className="grain">
      <SmoothScroll />
      <Nav />
      <main>
        <Hero />
        <Problem />
        <HowItSees />
        <Features />
      </main>
      <Footer />
    </div>
  );
}

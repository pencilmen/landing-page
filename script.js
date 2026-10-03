import gsap from "gsap";
import { SplitText } from "gsap/SplitText";
import { CustomEase } from "gsap/CustomEase";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

gsap.registerPlugin(SplitText, CustomEase, ScrollTrigger);
CustomEase.create("hop", "0.9,0,0.1,1");
CustomEase.create("glide", "0.8,0,0.2,1");

function init() {
    let preloaderComplete = false;

    // Lock page scroll during preloader
    document.body.style.overflow = "hidden";

    // Setup Lenis (starts stopped until preloader finishes)
    const lenis = new Lenis();
    lenis.stop();

    let targetVelocity = 0;
    lenis.on("scroll", (e) => {
        targetVelocity = Math.abs(e.velocity) * 0.02;
        ScrollTrigger.update();
    });

    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);

    // Elements & SVG setup
    const preloaderTexts = document.querySelectorAll(".preloader p");
    const preloaderBtn = document.querySelector(".pre-loader-button-container");
    const btnOutlineTrack = document.querySelector(".stroke-track");
    const btnOutlineProgress = document.querySelector(".stroke-progress");
    const svgPathLength = btnOutlineTrack ? btnOutlineTrack.getTotalLength() : 974;

    if (btnOutlineTrack && btnOutlineProgress) {
        gsap.set([btnOutlineTrack, btnOutlineProgress], {
            strokeDasharray: svgPathLength,
            strokeDashoffset: svgPathLength,
        });
    }

    // Split text for preloader terminal status lines
    preloaderTexts.forEach((p) => {
        new SplitText(p, {
            type: "lines",
            linesClass: "line",
            mask: "lines",
        });
    });

    // Split text for portfolio copy blocks
    const textBlocks = gsap.utils.toArray(".copy-block p");
    const splitInstance = textBlocks.map((block) =>
        SplitText.create(block, { type: "words", mask: "words" })
    );

    // Initial state: hide all copy block words below their masks
    splitInstance.forEach((inst) => {
        gsap.set(inst.words, { yPercent: 100 });
    });

    // Infinite Marquee setup
    const marqueeTrack = document.querySelector(".marquee-track");
    if (marqueeTrack) {
        const items = gsap.utils.toArray(".marquee-item");
        items.forEach((item) => marqueeTrack.appendChild(item.cloneNode(true)));
    }

    let marqueePosition = 0;
    let smoothVelocity = 0;

    gsap.ticker.add(() => {
        if (!marqueeTrack) return;
        smoothVelocity += (targetVelocity - smoothVelocity) * 0.5;

        const baseSpeed = 0.45;
        const speed = baseSpeed + smoothVelocity * 9;

        marqueePosition -= speed;

        const trackWidth = marqueeTrack.scrollWidth / 2;
        if (marqueePosition <= -trackWidth) {
            marqueePosition = 0;
        }

        gsap.set(marqueeTrack, { x: marqueePosition });
        targetVelocity *= 0.9;
    });

    const indicator = document.querySelector(".scroll-indicator");

    // Word progress calculation algorithm
    const overlapCount = 3;
    const getWordProgress = (phaseProgress, wordIndex, totalWords) => {
        const totalLength = 1 + overlapCount / totalWords;
        const scale = 1 / Math.min(
            totalLength,
            1 + (totalWords - 1) / totalWords + overlapCount / totalWords
        );
        const startTime = (wordIndex / totalWords) * scale;
        const endTime = startTime + (overlapCount / totalWords) * scale;
        const duration = endTime - startTime;

        if (phaseProgress <= startTime) return 0;
        if (phaseProgress >= endTime) return 1;
        return (phaseProgress - startTime) / duration;
    };

    const animateBlock = (outBlock, inBlock, phaseProgress) => {
        outBlock.words.forEach((word, i) => {
            const progress = getWordProgress(phaseProgress, i, outBlock.words.length);
            gsap.set(word, { yPercent: progress * 100 });
        });

        inBlock.words.forEach((word, i) => {
            const progress = getWordProgress(phaseProgress, i, inBlock.words.length);
            gsap.set(word, { yPercent: 100 - progress * 100 });
        });
    };

    // Preloader intro timeline
    const introTl = gsap.timeline({ delay: 1 });

    introTl
        .to(".preloader .p-row .line", {
            y: "0%",
            duration: 0.75,
            ease: "power3.out",
            stagger: 0.1,
        })
        .to(
            btnOutlineTrack,
            {
                strokeDashoffset: 0,
                duration: 2,
                ease: "hop",
            },
            "<",
        )
        .to(
            ".pbc-svg-strokes svg",
            {
                rotation: 270,
                duration: 2,
                ease: "hop",
            },
            "<",
        );

    const progressStops = [0.25, 0.5, 0.75, 1].map((base, i) => {
        if (i === 3) return 1;
        return base + (Math.random() - 0.5) * 0.1;
    });

    progressStops.forEach((stop, i) => {
        introTl.to(btnOutlineProgress, {
            strokeDashoffset: svgPathLength - svgPathLength * stop,
            duration: 0.75,
            ease: "glide",
            delay: i === 0 ? 0.3 : 0.3 + Math.random() * 0.2,
        });
    });

    introTl
        .to("#pbc-logo", { opacity: 0, duration: 0.35, ease: "power1.out" }, "-=0.25")
        .to(preloaderBtn, { scale: 0.9, duration: 1.5, ease: "hop" }, "-=0.5")
        .to(
            "#pbc-label .line",
            {
                y: "0%",
                duration: 0.75,
                ease: "power3.out",
                onComplete: () => {
                    preloaderComplete = true;
                },
            },
            "-=0.75",
        );

    // Preloader Exit & Hero Reveal
    preloaderBtn.addEventListener("click", () => {
        if (!preloaderComplete) return;
        preloaderComplete = false;

        const exitTl = gsap.timeline();

        exitTl
            .to(".preloader", {
                scale: 0.75,
                duration: 1.25,
                ease: "hop",
            })
            .to(
                [btnOutlineTrack, btnOutlineProgress],
                {
                    strokeDashoffset: -svgPathLength,
                    duration: 1.5,
                    ease: "hop",
                },
                "<",
            )
            .to("#pbc-label .line", { y: "-100%", duration: 0.75, ease: "power3.out" }, "-=1.25")
            .to("#pbc-outro-label .line", { y: "0%", duration: 0.75, ease: "power3.out" }, "-=0.75")
            // Double wipe leftward while hero stays at scale: 0.75
            .to(".preloader", {
                clipPath: "polygon(0% 0%, 0% 0%, 0% 100%, 0% 100%)",
                duration: 1.5,
                ease: "hop",
            })
            .to(
                ".preloader-revealer",
                {
                    clipPath: "polygon(0% 0%, 0% 0%, 0% 100%, 0% 100%)",
                    duration: 1.5,
                    ease: "hop",
                    onComplete: () => {
                        gsap.set([".preloader", ".preloader-revealer"], { display: "none" });
                    },
                },
                "-=1.45",
            )
            // As wipe animation starts, reveal newly added Netlify page inside compact hero (scale: 0.75)
            .to(
                splitInstance[0].words,
                {
                    yPercent: 0,
                    duration: 1,
                    ease: "power3.out",
                    stagger: 0.04,
                },
                "-=1.2",
            )
            .to(
                "nav",
                {
                    opacity: 1,
                    duration: 0.8,
                    ease: "power2.out",
                },
                "<",
            )
            // When all text of the hero quote is visible, scale hero to full size (scale: 1)
            .to(
                ".hero",
                {
                    scale: 1,
                    duration: 1.25,
                    ease: "hop",
                    onComplete: () => {
                        gsap.set(".preloader-backdrop", { display: "none" });
                        document.body.style.overflow = "auto";
                        lenis.start();

                        ScrollTrigger.create({
                            trigger: ".container",
                            start: "top top",
                            end: "bottom bottom",
                            onUpdate: (self) => {
                                const scrollProgress = self.progress;

                                if (indicator) {
                                    gsap.set(indicator, { "--progress": scrollProgress });
                                }

                                if (scrollProgress <= 0.5) {
                                    const phase1 = scrollProgress / 0.5;
                                    animateBlock(splitInstance[0], splitInstance[1], phase1);
                                } else {
                                    const phase2 = (scrollProgress - 0.5) / 0.5;
                                    gsap.set(splitInstance[0].words, { yPercent: 100 });
                                    animateBlock(splitInstance[1], splitInstance[2], phase2);
                                }
                            },
                        });

                        ScrollTrigger.refresh();

                        window.addEventListener("resize", () => {
                            ScrollTrigger.refresh();
                        });
                    },
                },
                "+=0.2",
            );
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}

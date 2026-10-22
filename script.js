import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { HorizontalBlurShader } from "three/examples/jsm/shaders/HorizontalBlurShader.js";
import { VerticalBlurShader } from "three/examples/jsm/shaders/VerticalBlurShader.js";
import gsap from "gsap";
import { SplitText } from "gsap/SplitText";
import { CustomEase } from "gsap/CustomEase";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

// Register GSAP plugins
gsap.registerPlugin(SplitText, CustomEase, ScrollTrigger);

// Custom Easing Curves
CustomEase.create("hop", "0.9, 0, 0.1, 1");
CustomEase.create("glide", "0.25, 1, 0.5, 1");

/**
 * 3D Sliced Gooey Hero Pipeline
 * Based on Sergey Borovikov's 3D Gooey Sliced Text effect.
 * Features:
 * - 200 instanced quads distributed along the Z-axis.
 * - Dynamic typographic width matching: Line 1 ("Visual Designer") matches Line 0 ("Neel") edge-to-edge.
 * - Offscreen 2D canvas texture with multi-pass Gaussian blur ping-pong passes.
 * - Custom GLSL 3.0 RawShaderMaterial rendering pure white cutouts with void black shadows.
 * - Gradual Hero Text size decrease on scroll.
 */
function createGooeyHero() {
    const canvas = document.querySelector("#gooey-hero-canvas");
    if (!canvas) return null;

    const pr = Math.min(2, window.devicePixelRatio || 1);
    const scene = new THREE.Scene();
    const world_z = new THREE.Vector3(0, 0, 1);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 4, -4);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: false });
    renderer.setPixelRatio(pr);
    renderer.setSize(window.innerWidth, window.innerHeight, false);

    //////// STATE & CONTROL VALUES (Exact production values from user specification)
    ///////
    const state = {
        band: {
            amount: 200,    // Number of instanced ribbon slices
            cutoff: 6.796,  // Power cutoff exponent for ribbon bands
            scale: 3.14,    // Z-axis spread and horizontal stretch of the quads
        },
        img: {
            blur: 1,        // Number of ping-pong blur passes
            cutoff: 0.8722, // Text gradient falloff power
            darken: 5,      // Darkening factor
        },
    };

    const render_update_list = new Set();

    //////// BLUR PASS
    ///////
    /*
     * Multi-pass Gaussian Blur Pipeline:
     * - Uses two WebGLRenderTargets (rt_a and rt_b).
     * - Copies the source 2D canvas texture into rt_a using copyTextureToTexture().
     * - Runs horizontal (x_pass) and vertical (y_pass) shader passes back and forth.
     */
    class BlurFilter {
        x_pass = new ShaderPass(HorizontalBlurShader);
        y_pass = new ShaderPass(VerticalBlurShader);
        rt_a;
        rt_b;
        constructor(renderer, width, height, flipY) {
            this.renderer = renderer;
            this.rt_a = new THREE.WebGLRenderTarget(width, height, { flipY });
            this.rt_b = this.rt_a.clone();
        }
        setSize(width, height) {
            this.rt_a.setSize(width, height);
            this.rt_b.setSize(width, height);
            this.renderer.initRenderTarget(this.rt_a);
            this.renderer.initRenderTarget(this.rt_b);
            this.x_pass.uniforms.h.value = 1 / width;
            this.y_pass.uniforms.v.value = 1 / height;
        }
        render(texture, repeat) {
            this.renderer.copyTextureToTexture(texture, this.rt_a.texture);
            for (let i = 0; i < repeat; i++) {
                this.x_pass.render(this.renderer, this.rt_b, this.rt_a, 0, false);
                this.y_pass.render(this.renderer, this.rt_a, this.rt_b, 0, false);
            }
            this.renderer.setRenderTarget(null);
        }
        get texture() {
            return this.rt_a.texture;
        }
    }

    const blur = new BlurFilter(renderer, 1, 1, true);

    //////// INPUT CANVAS (Static production typography)
    ///////
    // Texture downscaling factor for optimal Gaussian blur performance
    const input_scale = 1 / 2 / pr;

    const new_input_canvas = (width, height, scale, defaultText) => {
        let cw = width * scale;
        let ch = height * scale;

        // Use OffscreenCanvas if available; fallback to standard HTMLCanvasElement
        const canvasEl = typeof OffscreenCanvas !== "undefined"
            ? new OffscreenCanvas(Math.max(1, cw), Math.max(1, ch))
            : Object.assign(document.createElement("canvas"), { width: Math.max(1, cw), height: Math.max(1, ch) });
        const ctx = canvasEl.getContext("2d");

        let measure_size = (Math.min(cw, ch) / 2) | 0;
        let font_size = measure_size;
        let center_x = cw / 2;

        const get_font = (size, weight = "900") => `${weight} ${size}px 'Onest', sans-serif`;

        // Cross-browser helper to calculate total glyph ascent and descent
        const getFontHeight = (m, size) => {
            if (m.fontBoundingBoxAscent !== undefined && m.fontBoundingBoxDescent !== undefined) {
                return m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
            }
            if (m.actualBoundingBoxAscent !== undefined && m.actualBoundingBoxDescent !== undefined) {
                return (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) * 1.15;
            }
            return size * 1.2;
        };

        /*
         * Typographic Width-Matching Algorithm:
         * Calculates the bounding box width of Line 0 ("Neel") and Line 1 ("Visual Designer").
         * Computes the exact scale factor `w0 / wi` so that Line 1's rendered width
         * matches Line 0 edge-to-edge, aligning their left and right margins perfectly.
         */
        const computeLineScales = (lines, baseSize) => {
            if (lines.length <= 1) return [1.0];
            ctx.font = get_font(baseSize, "900");
            const w0 = ctx.measureText(lines[0]).width;
            return lines.map((line, i) => {
                if (i === 0) return 1.0;
                ctx.font = get_font(baseSize, "800");
                const wi = ctx.measureText(line).width;
                if (wi <= 0 || w0 <= 0) return 0.3;
                return Math.min(1.0, w0 / wi);
            });
        };

        // Measures text bounds and computes the maximum font size that fits the canvas
        const measure_text = (lines) => {
            let max_width = 0;
            let total_height = 0;

            ctx.textAlign = "center";
            ctx.textBaseline = "ideographic";

            const lineScales = computeLineScales(lines, measure_size);
            const lineWeights = lines.map((_, i) => (i === 0 ? "900" : "800"));
            const lineGap = lines.length > 1 ? Math.floor(measure_size * 0.02) : 0;

            for (let i = 0; i < lines.length; i++) {
                const lineSize = Math.max(1, Math.floor(measure_size * lineScales[i]));
                ctx.font = get_font(lineSize, lineWeights[i]);
                const m = ctx.measureText(lines[i]);
                max_width = Math.max(max_width, m.width);
                const h = getFontHeight(m, lineSize);
                total_height += h + (i > 0 ? lineGap : 0);
            }

            const width_ratio = (cw * 0.85) / Math.max(1, max_width);
            const height_ratio = (ch * 0.78) / Math.max(1, total_height);
            const min_ratio = Math.min(width_ratio, height_ratio);

            font_size = Math.floor(measure_size * min_ratio);
        };

        // Renders stacked text lines to canvas with width-matched font scaling
        const draw_text = (lines) => {
            ctx.clearRect(0, 0, cw, ch);

            ctx.textAlign = "center";
            ctx.textBaseline = "ideographic";
            ctx.fillStyle = "white";

            const lineScales = computeLineScales(lines, font_size);
            const lineWeights = lines.map((_, i) => (i === 0 ? "900" : "800"));
            const lineGap = lines.length > 1 ? Math.floor(font_size * 0.02) : 0;

            const heights = [];
            let totalBlockHeight = 0;

            for (let i = 0; i < lines.length; i++) {
                const lineSize = Math.max(1, Math.floor(font_size * lineScales[i]));
                ctx.font = get_font(lineSize, lineWeights[i]);
                const m = ctx.measureText(lines[i]);
                const h = getFontHeight(m, lineSize);
                heights.push(h);
                totalBlockHeight += h + (i > 0 ? lineGap : 0);
            }

            const paddingTop = Math.max(0, (ch - totalBlockHeight) / 2);
            let currentBaseline = paddingTop;

            for (let i = 0; i < lines.length; i++) {
                const lineSize = Math.max(1, Math.floor(font_size * lineScales[i]));
                ctx.font = get_font(lineSize, lineWeights[i]);
                currentBaseline += heights[i];
                ctx.fillText(lines[i], center_x, currentBaseline);
                currentBaseline += lineGap;
            }
        };

        const update = () => {
            const lines = defaultText.split("\n");
            measure_text(lines);
            draw_text(lines);
            instance.onupdate();
        };

        const resize = (w, h) => {
            cw = canvasEl.width = Math.max(1, Math.floor(w * scale));
            ch = canvasEl.height = Math.max(1, Math.floor(h * scale));
            measure_size = (Math.min(cw, ch) / 2) | 0;
            center_x = cw / 2;
        };

        const instance = {
            canvas: canvasEl,
            resize,
            update,
            onupdate() {},
        };

        return instance;
    };

    // Hero title typography lockup
    const hero_default_text = "Neel\nVisual Designer";
    const input_canvas = new_input_canvas(window.innerWidth, window.innerHeight, input_scale, hero_default_text);

    const input_texture = new THREE.CanvasTexture(input_canvas.canvas);

    const update_blur_rt = () => {
        input_texture.needsUpdate = true;
        blur.render(input_texture, state.img.blur);
    };

    input_canvas.onupdate = () => render_update_list.add(update_blur_rt);

    //////// MESH & SHADERS
    ///////
    const band_geometry = new THREE.PlaneGeometry(2, 2);

    /*
     * GLSL 3.0 RawShaderMaterial:
     * - Vertex Shader: Distributes 200 instanced quads along the Z-axis in modelViewMatrix space.
     *   Computes screen-space UV coordinates (suv) for texture sampling.
     * - Fragment Shader: Samples the blurred text map at suv, applies screen blending
     *   with the ribbon quad UV (y), and discards pixels where a < 0.5.
     *   Outputs pure solid white (vec3(1.0)) inside the cutouts with zero grey gradients.
     */
    const band_material = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: {
            amount: { value: state.band.amount },
            band_scale: { value: state.band.scale },
            map: { value: blur.texture },
            img_cutoff: { value: state.img.cutoff },
            band_cutoff: { value: 2 ** state.band.cutoff },
            fill_darken: { value: 2 ** state.img.darken },
        },
        vertexShader: /*glsl*/`
precision highp float;
in vec3 position;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float amount;
uniform float band_scale;
out vec2 vuv; // vertex uv
out vec2 suv; // screen uv
void main() {
  vec2 pos = position.xy;
  vuv = pos * 0.5 + 0.5;
  // band quad
  pos.y += 1.0;
  pos.y *= 0.5;
  pos.x *= 2.0 * band_scale;
  // spread quads across Z-axis
  float z_step = 4.0 * band_scale / amount;
  float z = 2.0 * band_scale - float(gl_InstanceID) * z_step;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, z, 1.0);
  suv = (gl_Position.xy / gl_Position.w) * 0.5 + 0.5;
}`,
        fragmentShader: /*glsl*/`
precision highp float;
in vec2 vuv; // vertex uv
in vec2 suv; // screen uv
uniform sampler2D map;
uniform float img_cutoff;
uniform float band_cutoff;
uniform float fill_darken;
out vec3 Color;

void main() {
  float y = 1.0 - vuv.y;
  if (y < 0.005 || y > 0.995) discard;

  float a = texture(map, suv).r;
  a *= pow(y, img_cutoff);
  y = pow(y, band_cutoff);
  a = 1.0 - (1.0 - a) * (1.0 - y); // "screen" blending
  if (a < 0.5) discard;

  Color = vec3(1.0); // Pure solid white inside the cutouts with zero grey gradient
}`,
    });

    // Create 200 instanced ribbon slices
    const bands_mesh = new THREE.InstancedMesh(band_geometry, band_material, state.band.amount);
    bands_mesh.frustumCulled = false;
    bands_mesh.rotation.x = -45 * THREE.MathUtils.DEG2RAD; // Slanted 3D plane orientation
    scene.add(bands_mesh);

    //////// RENDER LOOP
    ///////
    let time = 0;

    renderer.setAnimationLoop((t) => {
        // Execute scheduled uniform and blur pass updates
        for (const fn of render_update_list) fn();
        render_update_list.clear();

        const dt = t - time;
        time = t;

        // Continuous smooth rotation along the world Z-axis
        bands_mesh.rotateOnWorldAxis(world_z, dt * 0.0005);

        renderer.render(scene, camera);
    });

    //////// RESIZE HANDLER
    ///////
    const onResize = () => {
        const w = window.innerWidth;
        const h = window.innerHeight;

        renderer.setSize(w, h, false);

        const width = w * pr;
        const height = h * pr;
        blur.setSize(width * input_scale, height * input_scale);
        input_canvas.resize(w, h);
        input_canvas.update();
    };

    onResize();
    window.addEventListener("resize", onResize);

    // Re-render once web fonts are fully loaded to prevent font shift
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            input_canvas.update();
        });
    }

    return {
        /*
         * Drives scroll transition:
         * - Progressively scales down Hero Text size (scale: 1.0 -> 0.35).
         * - Smoothly fades canvas opacity into void black.
         * - Gently expands band_scale for liquid ribbon dispersion.
         */
        setMeltdown: (progress) => {
            const heroEl = document.querySelector(".sliced-gooey-hero");
            if (heroEl) {
                // Gradually decrease Hero Text size as user scrolls down
                const textScale = Math.max(0.35, 1.0 - Math.pow(progress, 0.85) * 0.65);
                // Smooth opacity fade out
                const alpha = Math.max(0, 1.0 - Math.pow(progress, 1.4));
                gsap.set(heroEl, {
                    scale: textScale,
                    opacity: alpha,
                    transformOrigin: "center center",
                    pointerEvents: progress > 0.02 ? "none" : "auto",
                });
            }
            if (band_material) {
                band_material.uniforms.band_scale.value = state.band.scale + progress * 4.0;
            }
        },
        destroy: () => {
            window.removeEventListener("resize", onResize);
            renderer.setAnimationLoop(null);
            renderer.dispose();
        },
    };
}

/**
 * Main application initialization:
 * Configures Lenis smooth scrolling, terminal preloader intro,
 * and ScrollTrigger multi-phase transitions.
 */
function init() {
    let preloaderComplete = false;
    const gooeyHero = createGooeyHero();

    // Lock page scroll during preloader
    document.body.style.overflow = "hidden";

    // Setup Lenis smooth scrolling (starts stopped until preloader finishes)
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

    // Infinite Marquee: Duplicate items for seamless continuous looping
    const marqueeTrack = document.querySelector(".marquee-track");
    if (marqueeTrack) {
        const items = gsap.utils.toArray(".marquee-item");
        items.forEach((item) => marqueeTrack.appendChild(item.cloneNode(true)));
    }

    let marqueePosition = 0;
    let smoothVelocity = 0;

    // Velocity-reactive marquee loop on GSAP ticker
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

    /*
     * Word Progress Calculation Algorithm:
     * Staggers word animations across the scroll phase with overlapping delays,
     * ensuring smooth reading cadence rather than abrupt text jumps.
     */
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

    // Transitions one quote block out while transitioning the next quote block in
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

    // Preloader intro timeline: Animates loading text and stroke progress stops
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

    // Random stops to simulate authentic system sequencing
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
                    preloaderComplete = true; // Unlock enter button interaction
                },
            },
            "-=0.75",
        );

    // Preloader Exit & Hero Reveal
    if (preloaderBtn) {
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
                // Scale hero to full size (scale: 1)
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

                            // Fade in the subtle scroll prompt
                            gsap.to(".hero-scroll-prompt", { opacity: 1, duration: 1, ease: "power2.out" });

                            /*
                             * ScrollTrigger Choreography:
                             * - Total track: 750vh pinned container
                             * - Phase 1 (0.0 -> 0.32): Sliced Gooey Hero melts down; Quote 0 & Marquee fade in (0.18 -> 0.32).
                             * - Phase 2 (0.32 -> 0.66): Quote 0 exits, Quote 1 enters.
                             * - Phase 3 (0.66 -> 1.0): Quote 1 exits, Quote 2 enters.
                             */
                            ScrollTrigger.create({
                                trigger: ".container",
                                start: "top top",
                                end: "bottom bottom",
                                onUpdate: (self) => {
                                    const scrollProgress = self.progress;

                                    // Phase 1: Sliced Gooey Hero Meltdown (0.0 -> 0.32)
                                    if (scrollProgress <= 0.32) {
                                        const melt = scrollProgress / 0.32;
                                        if (gooeyHero) gooeyHero.setMeltdown(melt);

                                        gsap.set(".hero-scroll-prompt", { opacity: Math.max(0, 1 - melt * 3) });

                                        // Hand off to Quote 0 and Marquee between 0.18 and 0.32
                                        if (scrollProgress >= 0.18) {
                                            const quoteIntro = (scrollProgress - 0.18) / 0.14;
                                            gsap.set([".about-copy", ".marquee"], {
                                                opacity: quoteIntro,
                                                pointerEvents: "auto",
                                            });
                                            splitInstance[0].words.forEach((w) => {
                                                gsap.set(w, { yPercent: (1 - quoteIntro) * 100 });
                                            });
                                        } else {
                                            gsap.set([".about-copy", ".marquee"], {
                                                opacity: 0,
                                                pointerEvents: "none",
                                            });
                                            splitInstance[0].words.forEach((w) => {
                                                gsap.set(w, { yPercent: 100 });
                                            });
                                        }
                                        splitInstance[1].words.forEach((w) => gsap.set(w, { yPercent: 100 }));
                                        splitInstance[2].words.forEach((w) => gsap.set(w, { yPercent: 100 }));
                                    }
                                    // Phase 2: Quote 0 -> Quote 1 (0.32 -> 0.66)
                                    else if (scrollProgress <= 0.66) {
                                        if (gooeyHero) gooeyHero.setMeltdown(1.0);
                                        gsap.set(".hero-scroll-prompt", { opacity: 0 });
                                        gsap.set([".about-copy", ".marquee"], { opacity: 1, pointerEvents: "auto" });

                                        const phase1 = (scrollProgress - 0.32) / 0.34;
                                        animateBlock(splitInstance[0], splitInstance[1], phase1);
                                        splitInstance[2].words.forEach((w) => gsap.set(w, { yPercent: 100 }));
                                    }
                                    // Phase 3: Quote 1 -> Quote 2 (0.66 -> 1.0)
                                    else {
                                        if (gooeyHero) gooeyHero.setMeltdown(1.0);
                                        gsap.set(".hero-scroll-prompt", { opacity: 0 });
                                        gsap.set([".about-copy", ".marquee"], { opacity: 1, pointerEvents: "auto" });

                                        const phase2 = (scrollProgress - 0.66) / 0.34;
                                        splitInstance[0].words.forEach((w) => gsap.set(w, { yPercent: 100 }));
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
}

// Ensure web fonts are parsed before starting measurements
function start() {
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(init);
    } else {
        init();
    }
}

// Run start once DOM is ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
} else {
    start();
}

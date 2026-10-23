import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { HorizontalBlurShader } from "three/examples/jsm/shaders/HorizontalBlurShader.js";
import { VerticalBlurShader } from "three/examples/jsm/shaders/VerticalBlurShader.js";
import GUI from "lil-gui";
import gsap from "gsap";
import { SplitText } from "gsap/SplitText";
import { CustomEase } from "gsap/CustomEase";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

// Register GSAP plugins & custom easing curves
gsap.registerPlugin(SplitText, CustomEase, ScrollTrigger);
CustomEase.create("hop", "0.9,0,0.1,1");
CustomEase.create("glide", "0.8,0,0.2,1");

/**
 * Creates and manages the 3D Sliced Gooey Text Hero WebGL experience.
 * Inspired by Sergey Borovikov's CodePen (upo11o/pen/GgWpVbO).
 */
function createGooeyHero() {
    const canvas = document.getElementById("gooey-hero-canvas");
    if (!canvas) return null;

    //////// SETUP
    ///////
    // Device pixel ratio clamped to 2 for optimal retina crispness and performance
    const pr = Math.min(2, window.devicePixelRatio || 1);

    const scene = new THREE.Scene();
    const world_z = new THREE.Vector3(0, 0, 1);

    /*
     * Orthographic Camera:
     * - Frustum: left=-1, right=1, top=1, bottom=-1, near=4, far=-4.
     * - Inverted near/far planes allow the geometry to be distributed
     *   along the Z-axis while keeping parallel projection without perspective distortion.
     */
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 4, -4);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: false });
    renderer.setPixelRatio(pr);
    renderer.setSize(window.innerWidth, window.innerHeight, false);

    //////// CONTROLS (lil-gui for dev branch)
    ///////
    const ui = new GUI();
    ui.close(); // Closed by default to keep the viewport unobscured

    // Control parameters: tuned for crystal-clear readability and fluid 3D ribbon effect
    const isMobileOrTablet = typeof window !== "undefined" && window.innerWidth < 1024;
    const state = {
        band: {
            amount: 200,    // Number of instanced ribbon slices
            cutoff: 6.796,  // Power cutoff exponent for ribbon bands
            scale: 3.14,    // Z-axis spread and horizontal stretch of the quads
        },
        img: {
            blur: isMobileOrTablet ? 0.25 : 1, // 0.25 on iPad & mobile keeps "Visual Designer" sharp & readable
            cutoff: 0.8722, // Text gradient falloff power
            darken: 5.0,    // Darkening factor
            line_brightness: 0.25, // Soft muted grey (~25%) for background slice lines
        },
    };

    const render_update_list = new Set();

    // Callbacks to sync shader uniforms when GUI sliders are tweaked
    const update_band_scale = () => {
        band_material.uniforms.band_scale.value = state.band.scale;
    };
    const update_img_cutoff = () => {
        band_material.uniforms.img_cutoff.value = state.img.cutoff;
    };
    const update_band_cutoff = () => {
        band_material.uniforms.band_cutoff.value = 2 ** state.band.cutoff;
    };
    const update_fill_darken = () => {
        band_material.uniforms.fill_darken.value = 2 ** state.img.darken;
    };
    const update_blur_rt = () => {
        input_texture.needsUpdate = true;
        blur.render(input_texture, state.img.blur);
    };

    // Ribbon band controls folder
    const band_ui = ui.addFolder("bands");
    band_ui.add(state.band, "cutoff", 1, 10).onChange(() => render_update_list.add(update_band_cutoff));
    band_ui.add(state.band, "scale", 1, 15).onChange(() => render_update_list.add(update_band_scale));

    const update_line_brightness = () => {
        band_material.uniforms.u_line_brightness.value = state.img.line_brightness;
    };

    let blurUserOverridden = false;

    // Blur & image post-processing controls folder
    const img_ui = ui.addFolder("image");
    const blurController = img_ui.add(state.img, "blur", 0, 10, 0.05).onChange(() => {
        blurUserOverridden = true;
        render_update_list.add(update_blur_rt);
    });
    img_ui.add(state.img, "cutoff", 0.01, 10).onChange(() => render_update_list.add(update_img_cutoff));
    img_ui.add(state.img, "darken", 0, 10).onChange(() => render_update_list.add(update_fill_darken));
    img_ui.add(state.img, "line_brightness", 0.0, 1.0, 0.05).name("line bright").onChange(() => render_update_list.add(update_line_brightness));

    //////// BLUR PASS
    ///////
    /*
     * Multi-pass Gaussian Blur Pipeline:
     * - Uses two WebGLRenderTargets (rt_a and rt_b).
     * - Copies the source 2D canvas texture into rt_a using copyTextureToTexture().
     * - Iteratively ping-pongs between HorizontalBlurShader and VerticalBlurShader
     *   for `repeat` iterations to create a smooth, viscous distance field.
     */
    class BlurFilter {
        constructor(renderer, width, height, flipY) {
            this.renderer = renderer;
            this.x_pass = new ShaderPass(HorizontalBlurShader);
            this.y_pass = new ShaderPass(VerticalBlurShader);
            this.rt_a = new THREE.WebGLRenderTarget(width, height, { flipY });
            this.rt_b = this.rt_a.clone();
            this.width = width;
            this.height = height;
        }
        setSize(width, height) {
            this.width = Math.max(1, width);
            this.height = Math.max(1, height);
            this.rt_a.setSize(this.width, this.height);
            this.rt_b.setSize(this.width, this.height);
            this.renderer.initRenderTarget(this.rt_a);
            this.renderer.initRenderTarget(this.rt_b);
            this.x_pass.uniforms.h.value = 1 / this.width;
            this.y_pass.uniforms.v.value = 1 / this.height;
        }
        render(texture, blurAmount) {
            this.renderer.copyTextureToTexture(texture, this.rt_a.texture);
            if (blurAmount <= 0.001) {
                this.renderer.setRenderTarget(null);
                return;
            }
            if (blurAmount < 1.0) {
                // Sub-pixel fractional Gaussian blur: scales step radius directly (e.g. 0.25x)
                this.x_pass.uniforms.h.value = (1 / this.width) * blurAmount;
                this.y_pass.uniforms.v.value = (1 / this.height) * blurAmount;
                this.x_pass.render(this.renderer, this.rt_b, this.rt_a, 0, false);
                this.y_pass.render(this.renderer, this.rt_a, this.rt_b, 0, false);
            } else {
                // Multi-pass Gaussian blur for values >= 1.0
                const passes = Math.round(blurAmount);
                const stepScale = blurAmount / passes;
                this.x_pass.uniforms.h.value = (1 / this.width) * stepScale;
                this.y_pass.uniforms.v.value = (1 / this.height) * stepScale;
                for (let i = 0; i < passes; i++) {
                    this.x_pass.render(this.renderer, this.rt_b, this.rt_a, 0, false);
                    this.y_pass.render(this.renderer, this.rt_a, this.rt_b, 0, false);
                }
            }
            this.renderer.setRenderTarget(null);
        }
        get texture() {
            return this.rt_a.texture;
        }
    }

    const blur = new BlurFilter(renderer, 1, 1, true);

    //////// INPUT CANVAS (with live contentEditable span in dev branch)
    ///////
    // Texture downscaling factor for optimal Gaussian blur performance
    const input_scale = 0.5;

    const new_input_canvas = (width, height, scale, text) => {
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

        /*
         * Live contentEditable text input (Dev Branch):
         * Transparent span positioned over the center of the canvas.
         * The user can click into the text and type live; changes instantly
         * update the canvas texture and recalculate ribbon formations.
         */
        const input = document.createElement("span");
        input.innerText = text;
        input.contentEditable = "true";
        input.className = "hero-text-input";
        input.style.cssText = `
            width: fit-content;
            min-width: 1em;
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            line-height: normal;
            text-align: center;
            white-space: pre-line;
            caret-color: #00F0FF;
            color: rgba(255, 0, 0, 0);
            z-index: 10;
            outline: none;
            border: none;
            cursor: text;
        `;

        const heroParent = document.querySelector(".sliced-gooey-hero") || document.body;
        heroParent.appendChild(input);

        // Dev badge indicating live input capability
        const editHint = document.createElement("div");
        editHint.className = "hero-edit-hint";
        editHint.innerText = "[DEV] Click text to edit live · lil-gui in top right";
        heroParent.appendChild(editHint);

        input.onfocus = () => {
            editHint.style.opacity = "0";
        };

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

            font_size = Math.max(8, (measure_size * min_ratio) | 0);
            input.style.font = get_font((font_size / scale) | 0, "900");
        };

        // Clears and draws the measured typography onto the off-screen canvas
        const draw_text = (lines) => {
            ctx.clearRect(0, 0, cw, ch);

            ctx.textAlign = "center";
            ctx.textBaseline = "ideographic";
            ctx.fillStyle = "white";

            const lineScales = computeLineScales(lines, font_size);
            const lineWeights = lines.map((_, i) => (i === 0 ? "900" : "800"));
            const lineGap = lines.length > 1 ? Math.floor(font_size * 0.02) : 0;

            let total_height = 0;
            const lineInfo = [];
            for (let i = 0; i < lines.length; i++) {
                const lineSize = Math.max(1, Math.floor(font_size * lineScales[i]));
                ctx.font = get_font(lineSize, lineWeights[i]);
                const m = ctx.measureText(lines[i]);
                const h = getFontHeight(m, lineSize);
                lineInfo.push({ size: lineSize, height: h, weight: lineWeights[i] });
                total_height += h + (i > 0 ? lineGap : 0);
            }

            const padding = (ch - total_height) / 2;
            let currentY = padding;

            for (let i = 0; i < lines.length; i++) {
                const info = lineInfo[i];
                ctx.font = get_font(info.size, info.weight);
                if (i > 0) currentY += lineGap;
                currentY += info.height;
                ctx.fillText(lines[i], center_x, currentY);
            }
        };

        // Updates canvas text when user edits the input span
        const update = () => {
            const raw = input.innerText.replace(/\r/g, "").replace(/\n$/, "");
            const lines = raw.split("\n");
            measure_text(lines);
            draw_text(lines);
            instance.onupdate();
        };

        input.oninput = update;

        // Resizes off-screen canvas buffers
        const resize = (w, h) => {
            cw = ctx.canvas.width = Math.max(1, Math.floor(w * scale));
            ch = ctx.canvas.height = Math.max(1, Math.floor(h * scale));
            measure_size = (Math.min(cw, ch) / 2) | 0;
            center_x = cw / 2;
        };

        const instance = {
            canvas: canvasEl,
            input,
            resize,
            update,
            onupdate() {},
        };

        return instance;
    };

    // Initial text for Option A: Title Case "Neel" and "Visual Designer"
    const input_canvas = new_input_canvas(window.innerWidth, window.innerHeight, input_scale, "Neel\nVisual Designer");

    const input_texture = new THREE.CanvasTexture(input_canvas.canvas);

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
     *   Outputs pure solid white (vec3(1.0)) inside the cutouts.
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
            u_text_scale: { value: 1.0 },
            u_text_opacity: { value: 1.0 },
            u_line_opacity: { value: 1.0 },
            u_line_brightness: { value: state.img.line_brightness },
        },
        vertexShader: /*glsl*/`
precision highp float;
in vec3 position;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float amount;
uniform float band_scale;
uniform float u_text_scale;
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
  
  // Center-anchored UV scaling: scales text towards center (0.5, 0.5)
  vec2 center_suv = (gl_Position.xy / gl_Position.w) * 0.5;
  suv = (center_suv / max(0.001, u_text_scale)) + 0.5;
}`,
        fragmentShader: /*glsl*/`
precision highp float;
in vec2 vuv; // vertex uv
in vec2 suv; // screen uv
uniform sampler2D map;
uniform float img_cutoff;
uniform float band_cutoff;
uniform float fill_darken;
uniform float u_text_opacity;
uniform float u_line_opacity;
uniform float u_line_brightness;
out vec3 Color;

void main() {
  float y = 1.0 - vuv.y;
  if (y < 0.005 || y > 0.995) discard;

  // Global discard when both text and lines have completely faded
  if (u_text_opacity <= 0.001 && u_line_opacity <= 0.001) discard;

  // Sample blurred text texture within valid [0, 1] screen bounds
  float raw_text = (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) ? 0.0 : texture(map, suv).r;

  float text_a = raw_text * pow(y, img_cutoff);
  float line_y = pow(y, band_cutoff);

  // Screen blending of text and lines geometry
  float a = 1.0 - (1.0 - text_a) * (1.0 - line_y);
  if (a < 0.5) discard;

  // Discern text region from background slice lines:
  // Inside text region: pure solid white (1.0) faded by u_text_opacity
  // Outside text region (background lines): soft muted grey (~0.25) faded by u_line_opacity
  float is_text = smoothstep(0.04, 0.28, raw_text);
  vec3 text_col = vec3(1.0) * u_text_opacity;
  vec3 line_col = vec3(u_line_brightness) * u_line_opacity;

  Color = mix(line_col, text_col, is_text);
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
        // Continuous slow rotation around the viewing axis (world Z)
        bands_mesh.rotateOnWorldAxis(world_z, dt * 0.0005);

        renderer.render(scene, camera);
    });

    //////// HELPERS & RESIZE
    ///////
    const onResize = () => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        renderer.setSize(w, h, false);

        if (!blurUserOverridden) {
            const isMobile = w < 1024;
            state.img.blur = isMobile ? 0.25 : 1;
            if (blurController && typeof blurController.updateDisplay === "function") {
                blurController.updateDisplay();
            }
        }

        input_canvas.resize(w, h);
        blur.setSize(input_canvas.canvas.width, input_canvas.canvas.height);
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
                // Keep the hero section full screen at scale: 1.0 (no whole-section box shrinking!)
                // Smoothly fade heroEl CSS opacity to 0 as it completes and hide it at 1.0
                const heroAlpha = Math.max(0, 1.0 - Math.pow(progress, 1.5));
                gsap.set(heroEl, {
                    scale: 1.0,
                    opacity: heroAlpha,
                    display: progress >= 1.0 ? "none" : "flex",
                    pointerEvents: progress > 0.02 ? "none" : "auto",
                });
            }
            if (input_canvas.input) {
                input_canvas.input.style.pointerEvents = progress > 0.02 ? "none" : "auto";
                // Match live editable input scale and opacity with text scale on dev
                const textScale = Math.max(0.35, 1.0 - Math.pow(progress, 0.85) * 0.65);
                const alpha = Math.max(0, 1.0 - Math.pow(progress, 1.3));
                gsap.set(input_canvas.input, {
                    scale: textScale,
                    opacity: alpha,
                    transformOrigin: "center center",
                });
            }
            if (band_material) {
                // Text scales down inside 3D space
                const textScale = Math.max(0.35, 1.0 - Math.pow(progress, 0.85) * 0.65);
                band_material.uniforms.u_text_scale.value = textScale;
                
                // Text slowly fades away
                const textOpacity = Math.max(0, 1.0 - Math.pow(progress, 1.3));
                band_material.uniforms.u_text_opacity.value = textOpacity;

                // Background lines slowly fade away across the full screen
                const lineOpacity = Math.max(0, 1.0 - Math.pow(progress, 1.05));
                band_material.uniforms.u_line_opacity.value = lineOpacity;
            }
        },
        destroy: () => {
            window.removeEventListener("resize", onResize);
            renderer.setAnimationLoop(null);
            renderer.dispose();
            ui.destroy();
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
    window.gooeyHero = gooeyHero;

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

    const indicator = document.querySelector(".scroll-indicator");

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

                                    if (indicator) {
                                        gsap.set(indicator, { "--progress": scrollProgress });
                                    }

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

import gsap from "gsap";

const labsData = [
    {
        tag: "EXP // 01",
        title: "Chromatic Void",
        desc: "Refraction gradients and high-frequency dispersion across curved glass surfaces.",
        image: "/src/1.jpg",
    },
    {
        tag: "EXP // 02",
        title: "Kinetic Topology",
        desc: "Parametric geometry shifting fluidly with rotational spring dynamics.",
        image: "/src/2.jpg",
    },
    {
        tag: "EXP // 03",
        title: "Subsurface Scattering",
        desc: "Diffuse photon penetration through multi-layered translucent polymers.",
        image: "/src/3.jpg",
    },
    {
        tag: "EXP // 04",
        title: "Spectral Flow",
        desc: "Dynamic fluid velocities driving procedural luminescence fields.",
        image: "/src/4.jpg",
    },
    {
        tag: "EXP // 05",
        title: "Quantum Lattice",
        desc: "Coherent atomic arrays rendering micro-scale gravitational waves.",
        image: "/src/5.jpg",
    },
    {
        tag: "EXP // 06",
        title: "Neural Synapse",
        desc: "Bio-synthetic neural networks firing high-frequency perceptual pulses.",
        image: "/src/6.jpg",
    },
    {
        tag: "EXP // 07",
        title: "Solar Horizon",
        desc: "Coronal mass ejections filtered through planetary magnetospheres.",
        image: "/src/7.jpg",
    },
    {
        tag: "EXP // 08",
        title: "Dark Matter Echo",
        desc: "Interferometry signals mapping invisible galactic filament networks.",
        image: "/src/8.jpg",
    },
    {
        tag: "EXP // 09",
        title: "Prismatic Singularity",
        desc: "Event horizon photon dispersion captured at Planck scale.",
        image: "/src/9.jpg",
    },
    {
        tag: "EXP // 10",
        title: "Aetheric Resonance",
        desc: "Harmonic vibrational patterns oscillating in hyper-dimensional space.",
        image: "/src/10.jpg",
    },
];

const config = {
    imageCount: labsData.length,
    visibleSlidesRight: 12,
    visibleSlidesLeft: 2,
    offsetStep: 12,
    rotationStep: -7,
    scaleStep: 0.05,
    blurStep: 0.25,
    brightnessStep: 0.1,
    minBrightness: 0.25,
    wheelSensitivity: 0.005,
    touchSensitivity: 0.0075,
    maxWheelData: 200,
    smoothing: 0.075,
    snapDelay: 250,
    swapThreshold: 0.5,
};

const slideCount = config.visibleSlidesLeft + config.visibleSlidesRight + 2;

const slider = document.querySelector(".slider");
const slidesContainer = document.querySelector(".slides");

for (let i = 0; i < slideCount; i++) {
    const slide = document.createElement("div");
    slide.className = "slide";
    slide.innerHTML = `
        <div class="slide-card">
            <div class="slide-img">
                <img alt="" draggable="false" />
            </div>
            <div class="slide-overlay">
                <div class="slide-content">
                    <span class="slide-tag"></span>
                    <h3 class="slide-title"></h3>
                    <p class="slide-desc"></p>
                </div>
            </div>
        </div>
    `;

    slidesContainer.appendChild(slide);
}

const slides = document.querySelectorAll(".slide");

let currentPosition = 0;
let targetPosition = 0;
let scrollDirection = 1;

const wrapOffset = gsap.utils.wrap(
    -(config.visibleSlidesLeft + 1),
    slideCount - (config.visibleSlidesLeft + 1),
);

const wrapImageIndex = gsap.utils.wrap(0, config.imageCount);

function updateSlideImage(slide, position) {
    const imageIndex = wrapImageIndex(Math.round(position));

    if (slide.dataset.image === String(imageIndex)) return;

    slide.dataset.image = imageIndex;
    const item = labsData[imageIndex];
    if (!item) return;

    const img = slide.querySelector("img");
    img.src = item.image;
    img.alt = item.title;

    const tagEl = slide.querySelector(".slide-tag");
    const titleEl = slide.querySelector(".slide-title");
    const descEl = slide.querySelector(".slide-desc");

    if (tagEl) tagEl.textContent = item.tag;
    if (titleEl) titleEl.textContent = item.title;
    if (descEl) descEl.textContent = item.desc;
}

function getSlideZIndex(offset) {
    const travelOffset = offset * scrollDirection;

    if (travelOffset >= 0) return Math.round(1000 - travelOffset * 10);

    if (travelOffset > -config.swapThreshold) return 1001;

    return Math.round(500 + travelOffset * 10);
}

function getSlideOpacity(offset) {
    const opacity =
        offset < 0
            ? config.visibleSlidesLeft + 1 + offset
            : config.visibleSlidesRight + 1 - offset;

    return gsap.utils.clamp(0, 1, opacity);
}

function isMobileView() {
    return window.innerWidth < 768;
}

function renderSlides() {
    const isMobile = isMobileView();

    slides.forEach((slide, index) => {
        const offset = wrapOffset(index - currentPosition);
        const distance = Math.abs(offset);

        // Out-of-focus blur across desktop, iPad, and mobile
        // Focused image (distance ≈ 0) is sharp (0px); surrounding images blur smoothly up to 12px
        const blur = Math.min(12, Math.pow(distance, 1.15) * 4.5);
        const brightness = Math.max(
            config.minBrightness,
            1 - distance * config.brightnessStep,
        );

        updateSlideImage(slide, currentPosition + offset);

        if (isMobile) {
            // Mobile (< 768px): Vertical Deck Layout
            // The focused image (distance ≈ 0) is elevated to full prominent height (1.05 scale),
            // while background/out-of-focus cards scale down to 0.78 for strong hierarchy
            const mobileScale = Math.max(0.78, 1.05 - distance * 0.12);
            gsap.set(slide, {
                xPercent: 0,
                yPercent: offset * 20,
                rotation: offset * -2,
                scale: mobileScale,
                filter: `blur(${blur}px) brightness(${brightness})`,
                opacity: getSlideOpacity(offset),
                zIndex: getSlideZIndex(offset),
            });
        } else {
            // Desktop & iPad (>= 768px): Horizontal Carousel Layout
            gsap.set(slide, {
                xPercent: offset * config.offsetStep,
                yPercent: 0,
                rotation: offset * config.rotationStep,
                scale: 1 - distance * config.scaleStep,
                filter: `blur(${blur}px) brightness(${brightness})`,
                opacity: getSlideOpacity(offset),
                zIndex: getSlideZIndex(offset),
            });
        }
    });
}

renderSlides();

let snapTimeout;

function snapToSlide() {
    const outgoingPosition =
        scrollDirection > 0
            ? Math.floor(targetPosition)
            : Math.ceil(targetPosition);

    const distanceMoved = Math.abs(targetPosition - outgoingPosition);

    targetPosition =
        distanceMoved < config.swapThreshold
            ? outgoingPosition
            : outgoingPosition + scrollDirection;
}

function closeAllOverlays() {
    slides.forEach((s) => s.classList.remove("is-active"));
}

function moveSlider(amount) {
    if (amount === 0) return;

    closeAllOverlays();
    scrollDirection = Math.sign(amount);
    targetPosition += amount;

    clearTimeout(snapTimeout);
    snapTimeout = setTimeout(snapToSlide, config.snapDelay);
}

slider.addEventListener(
    "wheel",
    (event) => {
        event.preventDefault();

        // Support both mouse wheel (deltaY) and horizontal trackpad swipes (deltaX)
        const rawDelta =
            Math.abs(event.deltaX) > Math.abs(event.deltaY)
                ? event.deltaX
                : event.deltaY;

        const delta = gsap.utils.clamp(
            -config.maxWheelData,
            config.maxWheelData,
            rawDelta,
        );

        moveSlider(delta * config.wheelSensitivity);
    },
    { passive: false },
);

// Drag & Tap Interaction (iPad, Mobile touch, and Desktop pointer drag)
let isPointerDown = false;
let isDragging = false;
let pointerStartX = 0;
let pointerStartY = 0;
let lastPointerX = 0;
let lastPointerY = 0;
let pointerStartTime = 0;
let lastMoveTime = 0;
let dragVelocity = 0;

slider.addEventListener("pointerdown", (event) => {
    // Left-click or touch only
    if (event.pointerType === "mouse" && event.button !== 0) return;

    isPointerDown = true;
    isDragging = false;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    pointerStartTime = Date.now();
    lastMoveTime = pointerStartTime;
    dragVelocity = 0;

    slider.classList.add("is-dragging");
});

window.addEventListener(
    "pointermove",
    (event) => {
        if (!isPointerDown) return;

        const currentX = event.clientX;
        const currentY = event.clientY;

        const totalDiffX = currentX - pointerStartX;
        const totalDiffY = currentY - pointerStartY;
        const totalDistance = Math.hypot(totalDiffX, totalDiffY);

        // Once moved more than 6px, commit to drag mode
        if (totalDistance > 6) {
            if (!isDragging) {
                isDragging = true;
                closeAllOverlays();
            }
        }

        if (isDragging) {
            const diffX = lastPointerX - currentX;
            const diffY = lastPointerY - currentY;

            // Responsive drag feel:
            // On mobile (vertical slider), vertical drag moves the deck
            // On desktop / iPad (horizontal slider), horizontal drag is primary
            const isMobile = isMobileView();
            const moveAmount = isMobile
                ? (Math.abs(diffY) >= Math.abs(diffX) ? diffY : diffX)
                : (Math.abs(diffX) >= Math.abs(diffY) ? diffX : diffY);

            const now = Date.now();
            const dt = Math.max(1, now - lastMoveTime);
            dragVelocity = (moveAmount * config.touchSensitivity) / (dt / 16);
            lastMoveTime = now;

            moveSlider(moveAmount * config.touchSensitivity);

            lastPointerX = currentX;
            lastPointerY = currentY;
        }
    },
    { passive: true },
);

function endPointerDrag(event) {
    if (!isPointerDown) return;
    isPointerDown = false;
    slider.classList.remove("is-dragging");

    const touchDuration = Date.now() - pointerStartTime;

    if (!isDragging && touchDuration < 350) {
        // Clean tap/click: toggle overlay on the tapped slide
        const targetSlide = event.target ? event.target.closest(".slide") : null;
        if (targetSlide) {
            const alreadyActive = targetSlide.classList.contains("is-active");
            closeAllOverlays();
            if (!alreadyActive) {
                targetSlide.classList.add("is-active");
            }
        } else {
            closeAllOverlays();
        }
    } else if (isDragging) {
        // Fling momentum when released with velocity
        if (Math.abs(dragVelocity) > 0.04) {
            const momentum = gsap.utils.clamp(-3, 3, dragVelocity * 6);
            moveSlider(momentum);
        }
    }

    isDragging = false;
}

window.addEventListener("pointerup", endPointerDrag);
window.addEventListener("pointercancel", endPointerDrag);

window.addEventListener("resize", () => {
    renderSlides();
});

gsap.ticker.add(() => {
    if (currentPosition === targetPosition) return;

    currentPosition += (targetPosition - currentPosition) * config.smoothing;

    if (Math.abs(targetPosition - currentPosition) < 0.001) {
        currentPosition = targetPosition;
    }

    renderSlides();
});
import gsap from "gsap";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(SplitText);

const CONFIG = {
    proximityRadius: 300,
    smoothing : 0.1,
};

const rootStyles =  getComputedStyle(document.documentElement);

const getFontWeight = (name) => 
    parseFloat(rootStyles.getPropertyValue(`--font-weight-${name}`));

const WEIGHT_THIN = getFontWeight("thin");
const WEIGHT_BLACK = getFontWeight("black");
const WEIGHT_MIDPOINT = (WEIGHT_THIN + WEIGHT_BLACK) / 2;

document.fonts.ready.then(() => {
    const spotlight = document.querySelector(".spotlight");
    const title = document.querySelector(".spotlight-title");

    const splitTitle = SplitText.create(title, {
        type : "lines, words, chars",
        linesClass : "spotlight-line",
    });

    title.classList.add("is-split");

    const characters = splitTitle.chars.map((element) => {
        const weightName =
            element.closest("[data-weight]")?.dataset.weight ?? "black";
        const baseWeight = getFontWeight(weightName);

       return {
        element,
        baseWeight,
        hoverWeight : baseWeight > WEIGHT_MIDPOINT ? WEIGHT_THIN : WEIGHT_BLACK,
        currentWeight : baseWeight,
        targetWeight : baseWeight,
        renderWeight : baseWeight,
        centerX : 0,
        centerY : 0,
       };
    });

    const cacheCharacterCenters = () => {
        characters.forEach((character) => {
            const rect = character.element.getBoundingClientRect();
            character.centerX = rect.left + rect.width / 2 + window.scrollX;
            character.centerY = rect.top + rect.height / 2 + window.scrollY;
        });
    };

    const handleMouseMove = (event) => {
        characters.forEach((character) => {
            const distance = Math.hypot(
                event.pageX - character.centerX,
                event.pageY - character.centerY
            );

            const proximity = gsap.utils.clamp (
                0,
                1,
                1 - distance / CONFIG.proximityRadius,
            );

            character.targetWeight = Math.round(
                gsap.utils.interpolate(
                    character.baseWeight,
                    character.hoverWeight,
                    proximity,
                ),
            );
        });
    };

    const resetFontWeights = () => {
        characters.forEach((character) => {
            character.targetWeight = character.baseWeight;
        });
    };

    const animateFontWeights = () => {
        const smoothingFactor = 
        1 - Math.pow(1 - CONFIG.smoothing,  gsap.ticker.deltaRatio());

        characters.forEach((character) => {
            const weightDifference = character.targetWeight - character.currentWeight;
            if (weightDifference === 0) return;
            
            character.currentWeight = 
            Math.abs(weightDifference) < 0.5 
            ? character.targetWeight
            : character.currentWeight + weightDifference * smoothingFactor;
            
            const roundedWeight = Math.round(character.currentWeight);
            if (roundedWeight === character.renderWeight) return;
            
            character.renderWeight = roundedWeight;
            character.element.style.fontWeight = roundedWeight;
        });

    };

    cacheCharacterCenters();

    gsap.ticker.add(animateFontWeights);
    spotlight.addEventListener("mousemove", handleMouseMove);
    spotlight.addEventListener("mouseleave", resetFontWeights);
    window.addEventListener("resize", cacheCharacterCenters);
});
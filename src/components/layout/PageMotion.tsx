import { motion, useReducedMotion } from "framer-motion";
import { forwardRef, type ReactNode } from "react";

const variants = {
    initial: { opacity: 0, y: 14 },
    animate: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.3, ease: "easeOut" as const },
    },
    exit: {
        opacity: 0,
        y: -8,
        transition: { duration: 0.15, ease: "easeIn" as const },
    },
};

/** Must forwardRef so AnimatePresence can run exit animations. */
const PageMotion = forwardRef<HTMLDivElement, { children: ReactNode }>(
    function PageMotion({ children }, ref) {
        const reduceMotion = useReducedMotion();

        if (reduceMotion) {
            return <div ref={ref}>{children}</div>;
        }

        return (
            <motion.div
                ref={ref}
                variants={variants}
                initial="initial"
                animate="animate"
                exit="exit"
            >
                {children}
            </motion.div>
        );
    },
);

export default PageMotion;

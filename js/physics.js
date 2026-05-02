export function springStep(current, target, velocity, stiffness, damping, dt) {
    const force = (target - current) * stiffness;
    velocity += force * dt;
    velocity *= damping;
    current += velocity * dt;
    return { value: current, velocity };
}

export function dampedOscillator(amplitude, damping, frequency, t) {
    return amplitude * Math.exp(-damping * t) * Math.cos(2 * Math.PI * frequency * t);
}

export function lerp(a, b, t) {
    return a + (b - a) * t;
}

export function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}
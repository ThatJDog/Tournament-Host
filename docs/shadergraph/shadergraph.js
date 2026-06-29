// ============================================
// Shader Graph Core (CPU-based, per-pixel)
// ============================================

class Graph {
    constructor() {
        this.nodes = new Map();
        this.edges = []; // list of Edge
    }

    add(node) {
        if (this.nodes.has(node.id)) {
            throw new Error(`Node with id "${node.id}" already exists.`);
        }
        this.nodes.set(node.id, node);
        return node;
    }

    connect(fromNode, fromPin, toNode, toPin) {
        const fromNodeId = typeof fromNode === "string" ? fromNode : fromNode.id;
        const toNodeId   = typeof toNode === "string" ? toNode : toNode.id;

        const fromNodeObj = this.nodes.get(fromNodeId);
        const toNodeObj   = this.nodes.get(toNodeId);

        if (!fromNodeObj || !toNodeObj) {
            throw new Error("Invalid node in edge.");
        }

        this.edges.push(new Edge(fromNodeId, fromPin, toNodeId, toPin));
    }

    compile(outputNode) {
        const outputNodeId = typeof outputNode === "string" ? outputNode : outputNode.id;
        const cache = new Map();

        const build = (nodeId) => {
            if (cache.has(nodeId)) return cache.get(nodeId);

            const node = this.nodes.get(nodeId);
            if (!node) throw new Error(`Node "${nodeId}" not found.`);

            // Build input functions per pin
            const inputFns = {};

            for (const pin of node.inputs) {
                const incomingEdges = this.edges.filter(
                    e => e.toNodeId === nodeId && e.toPin === pin.name
                );

                if (incomingEdges.length === 0) continue;

                if (incomingEdges.length > 1) {
                    throw new Error(`Multiple edges into pin "${pin.name}" not supported yet.`);
                }

                const edge = incomingEdges[0];

                const sourceFn = build(edge.fromNodeId);

                inputFns[pin.name] = (context) => {
                    const outputs = sourceFn(context);
                    const value = outputs[edge.fromPin];

                    // Type check (no casting yet)
                    const sourceNode = this.nodes.get(edge.fromNodeId);
                    const sourcePin = sourceNode.outputs.find(p => p.name === edge.fromPin);
                    const targetPin = node.inputs.find(p => p.name === pin.name);

                    if (sourcePin.type !== targetPin.type) {
                        throw new Error(
                            `Type mismatch: ${sourcePin.type} -> ${targetPin.type}`
                        );
                    }

                    return value;
                };
            }

            const fn = node.evaluate(inputFns);
            cache.set(nodeId, fn);
            return fn;
        };

        return build(outputNodeId);
    }
}

// ============================================
// Types
// ============================================

class TypedValue {
    constructor(type, value) {
        this.type = type;
        this.value = value;
    }
}

const Types = {
    FLOAT: "float",
    VEC2: "vec2",
    VEC3: "vec3",
    VEC4: "vec4",
    TEX: "tex",
};

function createFloat(v) {
    return {
        type: Types.FLOAT,
        value: v
    };
}

function createVec2(x, y) {
    return {
        type: Types.VEC2,
        value: [x, y]
    };
}

function createVec3(x, y, z) {
    return {
        type: Types.VEC3,
        value: [x, y, z]
    };
}

function createVec4(x, y, z, w) {
    return {
        type: Types.VEC4,
        value: [x, y, z, w]
    };
}

class Pin {
    constructor(name, type, direction) {
        this.name = name;         // string
        this.type = type;         // Types.FLOAT | VEC2 | VEC3
        this.direction = direction; // "in" | "out"
    }
}

class Edge {
    constructor(fromNodeId, fromPin, toNodeId, toPin) {
        this.fromNodeId = fromNodeId;
        this.fromPin = fromPin;
        this.toNodeId = toNodeId;
        this.toPin = toPin;
    }
}

// ============================================
// Base Node
// ============================================

class Node {

    static nextId = 0;

    constructor(id) {
        this.id = id ?? `node_${Node.nextId++}`;
        this.inputs = [];   // array of Pin
        this.outputs = [];  // array of Pin
    }

    getInputPins() {
        return this.inputs;
    }

    getOutputPins() {
        return this.outputs;
    }

    evaluate(inputValues) {
        // inputs.pinName(context) -> TypedValue
        throw new Error(`Node "${this.id}" must implement evaluate().`);
    }
}

// ============================================
// Utility Functions
// ============================================

function clamp01(v) {
    return Math.min(Math.max(v, 0), 1);
}

function repeat(v) {
    v = v % 1;
    return v < 0 ? v + 1 : v;
}

function lerpF(a, b, t) {
    return a + (b - a) * t;
}

const FloatOps = {
    // unary
    neg: (v) => createFloat(-v.value),
    abs: (v) => createFloat(Math.abs(v.value)),

    // binary
    add: (a, b) => createFloat(a.value + b.value),
    sub: (a, b) => createFloat(a.value - b.value),
    mul: (a, b) => createFloat(a.value * b.value),
    div: (a, b) => createFloat(a.value / b.value),
    mod: (a, b) => createFloat(a.value % b.value),

    // other
    lerp: (a, b, t) => createFloat(lerpF(a.value, b.value)),
};

const Vec2Ops = {
    // unary
    neg: (v) => createVec2(-v.value[0], -v.value[1]),

    // binary
    add: (a, b) => createVec2(
        a.value[0] + b.value[0],
        a.value[1] + b.value[1]
    ),
    sub: (a, b) => createVec2(
        a.value[0] - b.value[0],
        a.value[1] - b.value[1]
    ),
    mul: (a, b) => createVec2(
        a.value[0] * b.value[0],
        a.value[1] * b.value[1]
    ),
    div: (a, b) => createVec2(
        a.value[0] / b.value[0],
        a.value[1] / b.value[1]
    ),
    mod: (a, b) => createVec2(
        a.value[0] % b.value[0],
        a.value[1] % b.value[1]
    ),

    // other
    lerp: (a, b, t) => {
        return createVec2(
            lerpF(a.value[0], b.value[0], t),
            lerpF(a.value[1], b.value[1], t)
        );
    },
};

const Vec3Ops = {
    // unary
    neg: (v) => createVec3(
        -v.value[0],
        -v.value[1],
        -v.value[2]
    ),

    // binary
    add: (a, b) => createVec3(
        a.value[0] + b.value[0],
        a.value[1] + b.value[1],
        a.value[2] + b.value[2]
    ),
    sub: (a, b) => createVec3(
        a.value[0] - b.value[0],
        a.value[1] - b.value[1],
        a.value[2] - b.value[2]
    ),
    mul: (a, b) => createVec3(
        a.value[0] * b.value[0],
        a.value[1] * b.value[1],
        a.value[2] * b.value[2]
    ),
    div: (a, b) => createVec3(
        a.value[0] / b.value[0],
        a.value[1] / b.value[1],
        a.value[2] / b.value[2]
    ),
    mod: (a, b) => createVec3(
        a.value[0] % b.value[0],
        a.value[1] % b.value[1],
        a.value[2] % b.value[2]
    ),

    // other
    lerp: (a, b, t) => {
        return createVec3(
            lerpF(a.value[0], b.value[0], t),
            lerpF(a.value[1], b.value[1], t),
            lerpF(a.value[2], b.value[2], t)
        );
    },
};

const Vec4Ops = {
    // unary
    neg: (v) => createVec4(
        -v.value[0],
        -v.value[1],
        -v.value[2],
        -v.value[3]
    ),

    // binary
    add: (a, b) => createVec4(
        a.value[0] + b.value[0],
        a.value[1] + b.value[1],
        a.value[2] + b.value[2],
        a.value[3] + b.value[3]
    ),
    sub: (a, b) => createVec4(
        a.value[0] - b.value[0],
        a.value[1] - b.value[1],
        a.value[2] - b.value[2],
        a.value[3] - b.value[3]
    ),
    mul: (a, b) => createVec4(
        a.value[0] * b.value[0],
        a.value[1] * b.value[1],
        a.value[2] * b.value[2],
        a.value[3] * b.value[3]
    ),
    div: (a, b) => createVec4(
        a.value[0] / b.value[0],
        a.value[1] / b.value[1],
        a.value[2] / b.value[2],
        a.value[3] / b.value[3]
    ),
    mod: (a, b) => createVec4(
        a.value[0] % b.value[0],
        a.value[1] % b.value[1],
        a.value[2] % b.value[2],
        a.value[3] % b.value[3]
    ),

    // other
    lerp: (a, b, t) => {
        return createVec4(
            lerpF(a.value[0], b.value[0], t),
            lerpF(a.value[1], b.value[1], t),
            lerpF(a.value[2], b.value[2], t),
            lerpF(a.value[3], b.value[3], t)
        );
    },
};

// Colour utilities

// HSL -> RGB
function hslToRgb(h, s, l) {
    h = ((h % 1) + 1) % 1; // wrap
    s = clamp01(s);
    l = clamp01(l);

    if (s === 0) return [l, l, l];

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    const hue2rgb = (t) => {
        t = ((t % 1) + 1) % 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
    };

    return [
        hue2rgb(h + 1/3),
        hue2rgb(h),
        hue2rgb(h - 1/3)
    ];
}

// HSV -> RGB
function hsvToRgb(h, s, v) {
    h = ((h % 1) + 1) % 1;
    s = clamp01(s);
    v = clamp01(v);

    const i = Math.floor(h * 6);
    const f = h * 6 - i;

    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);

    switch (i % 6) {
        case 0: return [v, t, p];
        case 1: return [q, v, p];
        case 2: return [p, v, t];
        case 3: return [p, q, v];
        case 4: return [t, p, v];
        case 5: return [v, p, q];
    }
}

function hexToRgba(hex) {
    hex = hex.replace("#", "");

    let r, g, b, a = 255;

    if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
    } 
    else if (hex.length === 6) {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
    } 
    else if (hex.length === 8) {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
        a = parseInt(hex.slice(6, 8), 16);
    } 
    else {
        throw new Error("Invalid hex colour");
    }

    return [
        r / 255,
        g / 255,
        b / 255,
        a / 255
    ];
}

// ============================================
// Value Nodes
// ============================================

// For editor graph, we have a UINode class. It takes in a node
// and generates pins dynamically. We can then also add text fields
// for pins with types for default values or connections.

class FloatNode extends Node {
    constructor(value, id = null) {
        super(id);
        this.value = createFloat(value);

        this.outputs = [
            new Pin("out", Types.FLOAT, "out")
        ];
    }

    evaluate() {
        return () => ({
            out: this.value
        });
    }
}

// ============================================
// Literal Base (numbers -> typed value)
// ============================================

class LiteralValueNode extends Node {
    constructor(type, factory, components, id = null) {
        super(id);

        this.type = type;
        this.value = factory(...components);

        this.outputs = [
            new Pin("out", type, "out")
        ];
    }

    evaluate() {
        return () => ({
            out: this.value
        });
    }
}

// ============================================
// Compose Base (float inputs -> typed value)
// ============================================

class ComposeValueNode extends Node {
    constructor(type, factory, arity, id = null) {
        super(id);

        this.type = type;
        this.factory = factory;

        this.inputs = Array.from({ length: arity }, (_, i) =>
            new Pin(`in${i}`, Types.FLOAT, "in")
        );

        this.outputs = [
            new Pin("out", type, "out")
        ];
    }

    evaluate(inputs) {
        return (context) => {
            const values = this.inputs.map(pin =>
                inputs[pin.name](context).value
            );

            return {
                out: this.factory(...values)
            };
        };
    }
}

// ============================================
// Float Nodes
// ============================================

class FloatLitNode extends LiteralValueNode {
    constructor(v, id = null) {
        super(Types.FLOAT, createFloat, [v], id);
    }
}

// ============================================
// Vec2 Nodes
// ============================================

class Vec2LitNode extends LiteralValueNode {
    constructor(x, y, id = null) {
        super(Types.VEC2, createVec2, [x, y], id);
    }
}

class Vec2ComposeNode extends ComposeValueNode {
    constructor(id = null) {
        super(Types.VEC2, createVec2, 2, id);
    }
}

// ============================================
// Vec3 Nodes
// ============================================

class Vec3LitNode extends LiteralValueNode {
    constructor(x, y, z, id = null) {
        super(Types.VEC3, createVec3, [x, y, z], id);
    }
}

class Vec3ComposeNode extends ComposeValueNode {
    constructor(id = null) {
        super(Types.VEC3, createVec3, 3, id);
    }
}

// ============================================
// Vec4 Nodes
// ============================================

class Vec4LitNode extends LiteralValueNode {
    constructor(x, y, z, w, id = null) {
        super(id, Types.VEC4, createVec4, [x, y, z, w]);
    }
}

class Vec4ComposeNode extends ComposeValueNode {
    constructor(id = null) {
        super(id, Types.VEC4, createVec4, 4);
    }
}

function createColourRGB(r, g, b, a = 1) {
    return createVec4(
        clamp01(r),
        clamp01(g),
        clamp01(b),
        clamp01(a)
    );
}

function createColourRGB8(r, g, b, a = 255) {
    return createVec4(
        clamp01(r / 255),
        clamp01(g / 255),
        clamp01(b / 255),
        clamp01(a / 255)
    );
}

function createColourHSL(h, s, l, a = 1) {
    const [r, g, b] = hslToRgb(h, s, l);
    return createVec4(r, g, b, clamp01(a));
}

function createColourHSV(h, s, v, a = 1) {
    const [r, g, b] = hsvToRgb(h, s, v);
    return createVec4(r, g, b, clamp01(a));
}

function createColourHex(hex) {
    return createVec4(hexToRgba(hex));
}
// ============================================
// Math Nodes
// ============================================

class UnaryOpNode extends Node {
    constructor(type, op, id = null) {
        super(id);

        this.type = type;
        this.op = op;

        if (!op) {
            throw new Error(`Requires op "${this.opName}" for type "${this.type}"`);
        }

        this.inputs = [
            new Pin("in", type, "in"),
        ];

        this.outputs = [
            new Pin("out", type, "out")
        ];
    }

    evaluate(inputs) {
        return (context) => {
            const v = inputs.in(context);

            return {
                out: this.op(v)
            };
        };
    }
}

class BinaryOpNode extends Node {
    constructor(type, op, id = null) {
        super(id);

        this.type = type;
        this.op = op;

        if (!op) {
            throw new Error(`Requires op "${this.opName}" for type "${this.type}"`);
        }

        this.inputs = [
            new Pin("a", type, "in"),
            new Pin("b", type, "in")
        ];

        this.outputs = [
            new Pin("out", type, "out")
        ];
    }

    evaluate(inputs) {
        return (context) => {
            const a = inputs.a(context);
            const b = inputs.b(context);

            return {
                out: this.op(a, b)
            };
        };
    }
}

function createUnaryNode(type, opRegistry, opName, id = null) {
    return new class extends UnaryOpNode {
        constructor() {
            super(type, opRegistry[opName], id);
        }
    }();
}

function createBinaryNode(type, opRegistry, opName, id = null) {
    return new class extends BinaryOpNode {
        constructor() {
            super(type, opRegistry[opName], id);
        }
    }();
}

// Float op nodes
const FloatNegNode = (id = null) => createUnaryNode(Types.FLOAT, FloatOps, "neg", id);

const FloatAddNode = (id = null) => createBinaryNode(Types.FLOAT, FloatOps, "add", id);
const FloatSubNode = (id = null) => createBinaryNode(Types.FLOAT, FloatOps, "sub", id);
const FloatMulNode = (id = null) => createBinaryNode(Types.FLOAT, FloatOps, "mul", id);
const FloatDivNode = (id = null) => createBinaryNode(Types.FLOAT, FloatOps, "div", id);
const FloatModNode = (id = null) => createBinaryNode(Types.FLOAT, FloatOps, "mod", id);

// Vec2 op nodes
const Vec2NegNode = (id = null) => createUnaryNode(Types.VEC2, Vec2Ops, "neg", id);

const Vec2AddNode = (id = null) => createBinaryNode(Types.VEC2, Vec2Ops, "add", id);
const Vec2SubNode = (id = null) => createBinaryNode(Types.VEC2, Vec2Ops, "sub", id);
const Vec2MulNode = (id = null) => createBinaryNode(Types.VEC2, Vec2Ops, "mul", id);
const Vec2DivNode = (id = null) => createBinaryNode(Types.VEC2, Vec2Ops, "div", id);
const Vec2ModNode = (id = null) => createBinaryNode(Types.VEC2, Vec2Ops, "mod", id);

// Vec3 op nodes
const Vec3NegNode = (id = null) => createUnaryNode(Types.VEC3, Vec3Ops, "neg", id);

const Vec3AddNode = (id = null) => createBinaryNode(Types.VEC3, Vec3Ops, "add", id);
const Vec3SubNode = (id = null) => createBinaryNode(Types.VEC3, Vec3Ops, "sub", id);
const Vec3MulNode = (id = null) => createBinaryNode(Types.VEC3, Vec3Ops, "mul", id);
const Vec3DivNode = (id = null) => createBinaryNode(Types.VEC3, Vec3Ops, "div", id);
const Vec3ModNode = (id = null) => createBinaryNode(Types.VEC3, Vec3Ops, "mod", id);

// Vec4 op nodes
const Vec4NegNode = (id = null) => createUnaryNode(Types.VEC4, Vec4Ops, "neg", id);

const Vec4AddNode = (id = null) => createBinaryNode(Types.VEC4, Vec4Ops, "add", id);
const Vec4SubNode = (id = null) => createBinaryNode(Types.VEC4, Vec4Ops, "sub", id);
const Vec4MulNode = (id = null) => createBinaryNode(Types.VEC4, Vec4Ops, "mul", id);
const Vec4DivNode = (id = null) => createBinaryNode(Types.VEC4, Vec4Ops, "div", id);
const Vec4ModNode = (id = null) => createBinaryNode(Types.VEC4, Vec4Ops, "mod", id);

// ============================================
// Break Nodes (Decompose)
// ============================================

class BreakVec2Node extends Node {
    constructor(id = null) {
        super(id);

        this.inputs = [
            new Pin("in", Types.VEC2, "in")
        ];

        this.outputs = [
            new Pin("x", Types.FLOAT, "out"),
            new Pin("y", Types.FLOAT, "out")
        ];
    }

    evaluate(inputs) {
        return (context) => {
            const v = inputs.in(context).value;

            return {
                x: createFloat(v[0]),
                y: createFloat(v[1])
            };
        };
    }
}

class BreakVec3Node extends Node {
    constructor(id = null) {
        super(id);

        this.inputs = [
            new Pin("in", Types.VEC3, "in")
        ];

        this.outputs = [
            new Pin("x", Types.FLOAT, "out"),
            new Pin("y", Types.FLOAT, "out"),
            new Pin("z", Types.FLOAT, "out")
        ];
    }

    evaluate(inputs) {
        return (context) => {
            const v = inputs.in(context).value;

            return {
                x: createFloat(v[0]),
                y: createFloat(v[1]),
                z: createFloat(v[2])
            };
        };
    }
}

class BreakVec4Node extends Node {
    constructor(id = null) {
        super(id);

        this.inputs = [
            new Pin("in", Types.VEC4, "in")
        ];

        this.outputs = [
            new Pin("x", Types.FLOAT, "out"),
            new Pin("y", Types.FLOAT, "out"),
            new Pin("z", Types.FLOAT, "out"),
            new Pin("w", Types.FLOAT, "out")
        ];
    }

    evaluate(inputs) {
        return (context) => {
            const v = inputs.in(context).value;

            return {
                x: createFloat(v[0]),
                y: createFloat(v[1]),
                z: createFloat(v[2]),
                w: createFloat(v[3])
            };
        };
    }
}

class LerpNode extends Node {
    constructor(type, id = null) {
        super(id);

        this.type = type;

        this.inputs = [
            new Pin("a", type, "in"),
            new Pin("b", type, "in"),
            new Pin("t", Types.FLOAT, "in")
        ];

        this.outputs = [
            new Pin("out", type, "out")
        ];
    }

    static lerpFloatNode(id = null) {
        return LerpNode(Types.FLOAT, id)
    }

    static lerpVec2Node(id = null) {
        return LerpNode(Types.VEC2, id)
    }

    static lerpVec3Node(id = null) {
        return LerpNode(Types.VEC3, id)
    }

    static lerpVec4Node(id = null) {
        return LerpNode(Types.VEC4, id)
    }

    getOp() {
        if (this.type === Types.FLOAT) return FloatOps.lerp;
        if (this.type === Types.VEC2) return Vec2Ops.lerp;
        if (this.type === Types.VEC3) return Vec3Ops.lerp;
        if (this.type === Types.VEC4) return Vec4Ops.lerp;
        throw new Error(`No lerp defined for type ${this.type}`);
    }

    evaluate(inputs) {
        return (context) => {
            const a = inputs.a(context);
            const b = inputs.b(context);
            const t = inputs.t(context);

            const op = this.getOp();

            return {
                out: op(a, b, t)
            };
        };
    }
}

// Shape nodes
class RectMaskNode extends Node {
    constructor(x, y, w, h, id = null) {
        super(id);

        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;

        this.inputs = [
            new Pin("uv", Types.VEC2, "in")
        ];

        this.outputs = [
            new Pin("out", Types.FLOAT, "out")
        ];
    }

    evaluate(inputs) {
        return (context) => {
            const uv = inputs.uv(context).value;
            const u = uv[0];
            const v = uv[1];

            const inside =
                u >= this.x &&
                u <= this.x + this.w &&
                v >= this.y &&
                v <= this.y + this.h;

            return {
                out: createFloat(inside ? 1 : 0)
            };
        };
    }
}

// ============================================
// Image Sampling Node
// ============================================

class UVNode extends Node {
    constructor(id = null) {
        super(id);

        this.outputs = [
            new Pin("uv", Types.VEC2, "out")
        ];
    }

    evaluate() {
        return (context) => ({
            uv: createVec2(context.uv[0], context.uv[1])
        });
    }
}

class OutResNode extends Node {
    constructor(id = null) {
        super(id);

        this.outputs = [
            new Pin("out", Types.VEC2, "out")
        ];
    }

    evaluate() {
        return (context) => ({
            out: createVec2(context.width, context.height)
        });
    }
}

class UVTransformNode extends Node {
    constructor(id = null) {
        super(id);

        this.inputs = [
            new Pin("uv", Types.VEC2, "in"),
            new Pin("scale", Types.VEC2, "in"),
            new Pin("offset", Types.VEC2, "in"),
            new Pin("pivot", Types.VEC2, "in"),
            new Pin("angle", Types.FLOAT, "in") // radians or degrees
        ];

        this.outputs = [
            new Pin("out", Types.VEC2, "out")
        ];
    }

    evaluate(inputs) {
        return (context) => {
            const uv = inputs.uv(context).value;
            const scale = inputs.scale(context).value;
            const offset = inputs.offset(context).value;
            const pivot = inputs.pivot(context).value;
            const angleDeg = inputs.angle(context).value;

            const rad = angleDeg * Math.PI / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);

            // translate to pivot
            let x = uv[0] - pivot[0];
            let y = uv[1] - pivot[1];

            // scale
            x *= scale[0];
            y *= scale[1];

            // rotate
            const rx = x * cos - y * sin;
            const ry = x * sin + y * cos;

            // translate back + offset
            return {
                out: createVec2(
                    rx + pivot[0] + offset[0],
                    ry + pivot[1] + offset[1]
                )
            };
        };
    }
}

class UVScaleCenteredNode extends Node {
    constructor(id = null) {
        super(id);

        this.inputs = [
            new Pin("uv", Types.VEC2, "in"),
            new Pin("scale", Types.VEC2, "in")
        ];

        this.outputs = [
            new Pin("out", Types.VEC2, "out")
        ];
    }

    evaluate(inputs) {
        return (context) => {
            const uv = inputs.uv(context).value;
            const scale = inputs.scale(context).value;

            const pivot = [0.5, 0.5];

            const x = (uv[0] - pivot[0]) * scale[0] + pivot[0];
            const y = (uv[1] - pivot[1]) * scale[1] + pivot[1];

            return {
                out: createVec2(x, y)
            };
        };
    }
}

class UVRotateCenteredNode extends Node {
    constructor(id = null) {
        super(id);

        this.inputs = [
            new Pin("uv", Types.VEC2, "in"),
            new Pin("angle", Types.FLOAT, "in")
        ];

        this.outputs = [
            new Pin("out", Types.VEC2, "out")
        ];
    }

    evaluate(inputs) {
        return (context) => {
            const uv = inputs.uv(context).value;
            const angleDeg = inputs.angle(context).value;

            const pivot = [0.5, 0.5];

            const rad = angleDeg * Math.PI / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);

            const dx = uv[0] - pivot[0];
            const dy = uv[1] - pivot[1];

            const x = dx * cos - dy * sin + pivot[0];
            const y = dx * sin + dy * cos + pivot[1];

            return {
                out: createVec2(x, y)
            };
        };
    }
}

class AlignUvNode extends Node {
    constructor(id = null) {
        super(id);

        this.inputs = [
            new Pin("uv", Types.VEC2, "in"),
            new Pin("sourceRes", Types.VEC2, "in"), // vec2(width, height)
            new Pin("outRes", Types.VEC2, "in"),    // vec2(width, height)
            // new Pin("preserveSize", Types.FLOAT, "in") // > 0 = true
        ];

        this.outputs = [
            new Pin("uv", Types.VEC2, "out")
        ];
    }

    evaluate(inputs) {
        return (context) => {
            const uv = inputs.uv(context).value;
            const src = inputs.sourceRes(context).value; // [w, h]
            const dst = inputs.outRes(context).value;    // [w, h]
            // const preserveSize = inputs.preserveSize(context).value > 0;
            const preserveSize = 1;

            let resultUv;

            if (preserveSize) {
                // ---- Native size mode (no aspect fill) ----
                const scaleX = src[0] / dst[0];
                const scaleY = src[1] / dst[1];

                const centeredU = uv[0] - 0.5;
                const centeredV = uv[1] - 0.5;

                resultUv = createVec2(
                    centeredU / scaleX + 0.5,
                    centeredV / scaleY + 0.5
                );
            } else {
                // ---- Aspect-fit mode (letterbox) ----
                const srcAspect = src[0] / src[1];
                const dstAspect = dst[0] / dst[1];

                let scaleX = 1.0;
                let scaleY = 1.0;

                if (dstAspect > srcAspect) {
                    scaleX = srcAspect / dstAspect;
                } else {
                    scaleY = dstAspect / srcAspect;
                }

                const centeredU = uv[0] - 0.5;
                const centeredV = uv[1] - 0.5;

                const alignedU = centeredU * scaleX;
                const alignedV = centeredV * scaleY;

                resultUv = createVec2(
                    alignedU + 0.5,
                    alignedV + 0.5
                );
            }

            return {
                uv: resultUv
            };
        };
    }
}

const TilingModes = {
    CLAMP: "clamp",
    TILE: "tile",
    ZERO: "zero"
};

class ImageNode extends Node {
    constructor(imageData, id = null) {
        super(id);

        this.imageData = imageData;

        this.inputs = [];

        this.outputs = [
            new Pin("tex", Types.TEX, "out"),
            new Pin("res", Types.VEC2, "out"),
        ];
    }

    evaluate(inputs) {
        const { width, height, data, tiling } = this.imageData;

        return (context) => {
            return {
                tex: new TypedValue(Types.Tex, this.imageData),
                res: createVec2(width, height),
            }
        }
    }
}

class SampleTextureNode extends Node {
    constructor(id = null) {
        super(id);

        this.inputs = [
            new Pin("uv", Types.VEC2, "in"),
            new Pin("texture", Types.TEX, "in"),
        ];

        this.outputs = [
            new Pin("out", Types.VEC4, "out"),
        ];
    }

    evaluate(inputs) {
        return (context) => {
            const { width, height, data, tiling } = inputs.texture(context).value;

            // --- UV ---
            let uv = inputs.uv(context).value;
            let u = uv[0];
            let v = uv[1];

            // --- Optional scale ---
            if (inputs.scale) {
                const s = inputs.scale(context).value;
                u *= s[0];
                v *= s[1];
            }

            // --- Optional offset ---
            if (inputs.offset) {
                const o = inputs.offset(context).value;
                u += o[0];
                v += o[1];
            }

            // --- Tiling ---
            if (tiling === TilingModes.TILE) {
                u = ((u % 1) + 1) % 1;
                v = ((v % 1) + 1) % 1;
            } 
            else if (tiling === TilingModes.CLAMP) {
                u = Math.min(Math.max(u, 0), 1);
                v = Math.min(Math.max(v, 0), 1);
            } 
            else if (tiling === TilingModes.ZERO) {
                if (u < 0 || u > 1 || v < 0 || v > 1) {
                    return { out: createVec4(0, 0, 0, 0) };
                }
            }

            // --- Sample ---
            const x = Math.floor(u * (width - 1));
            const y = Math.floor(v * (height - 1));

            const i = (y * width + x) * 4;

            const r = data[i] / 255;
            const g = data[i + 1] / 255;
            const b = data[i + 2] / 255;
            const a = data[i + 3] / 255;

            return {
                out: createVec4(r, g, b, a),
            };
        };
    }
}

class OffscreenRenderer {
    constructor() {
        this.canvas = document.createElement("canvas");
        this.ctx = this.canvas.getContext("2d");
    }

    render(html, width, height) {
        return new Promise((resolve) => {
            const wrapper = document.createElement("div");

            wrapper.style.position = "absolute";
            wrapper.style.left = "-99999px";
            wrapper.style.top = "-99999px";
            wrapper.style.width = width + "px";
            wrapper.style.height = height + "px";
            wrapper.innerHTML = html;

            document.body.appendChild(wrapper);

            // Use html2canvas-like manual rendering via SVG foreignObject
            const svg = `
                <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
                    <foreignObject width="100%" height="100%">
                        ${new XMLSerializer().serializeToString(wrapper)}
                    </foreignObject>
                </svg>
            `;

            const img = new Image();
            const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
            const url = URL.createObjectURL(blob);

            img.onload = () => {
                this.canvas.width = width;
                this.canvas.height = height;

                this.ctx.clearRect(0, 0, width, height);
                this.ctx.drawImage(img, 0, 0);

                const imageData = this.ctx.getImageData(0, 0, width, height);

                document.body.removeChild(wrapper);
                URL.revokeObjectURL(url);

                resolve(imageData);
            };

            img.src = url;
        });
    }
}

class ResourceManager {
    constructor() {
        this.cache = new Map();
        this.renderer = new OffscreenRenderer();
    }

    async loadImage(path, tiling = TilingModes.TILE) {
        if (this.cache.has(path)) {
            return this.cache.get(path);
        }

        const img = new Image();
        img.src = path;

        await img.decode();

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        canvas.width = img.width;
        canvas.height = img.height;

        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, img.width, img.height);

        const result = {
            width: img.width,
            height: img.height,
            data: imageData.data,
            tiling: tiling,
        };

        this.cache.set(path, result);
        return result;
    }

    async loadText(text, options = {}) {
        const {
            font = "16px sans-serif",
            color = "black",
            width = 256,
            height = 64,
            align = "center",
            baseline = "middle"
        } = options;

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        canvas.width = width;
        canvas.height = height;

        ctx.clearRect(0, 0, width, height);

        ctx.font = font;
        ctx.fillStyle = color;
        ctx.textAlign = align;
        ctx.textBaseline = baseline;

        ctx.fillText(text, width / 2, height / 2);

        const imageData = ctx.getImageData(0, 0, width, height);

        const result = {
            width,
            height,
            data: imageData.data,
            tiling: TilingModes.ZERO,
        };

        this.cache.set(this._makeKey("text", { text, options }), result);
        return result;
    }


    // The following taint the canvas and throws an error


    _makeKey(type, payload) {
        return JSON.stringify({ type, payload });
    }

    async loadHTMLElement(html, width, height) {
        const key = this._makeKey("html", { html, width, height });

        if (this.cache.has(key)) {
            return this.cache.get(key);
        }

        const imageData = await this.renderer.render(html, width, height);

        const result = {
            width,
            height,
            data: imageData.data,
            tiling: TilingModes.ZERO,
        };

        this.cache.set(key, result);
        return result;
    }

    async loadTextOffload(text, options = {}) {
        const {
            font = "16px sans-serif",
            color = "black",
            width = 256,
            height = 64,
            align = "left",
            baseline = "top"
        } = options;

        const html = `
            <div style="
                width:${width}px;
                height:${height}px;
                display:flex;
                align-items:${baseline === "middle" ? "center" : "flex-start"};
                justify-content:${align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start"};
                font:${font};
                color:${color};
                overflow:hidden;
                white-space:nowrap;
            ">
                ${text}
            </div>
        `;

        return this.loadHTMLElement(html, width, height);
    }
}

// Casting

function resolveColor(out) {
    if (out.type === Types.FLOAT) {
        const v = out.value;
        return [v, v, v, 1];
    }
    if (out.type === Types.VEC3) {
        return [...out.value, 1];
    }
    if (out.type === Types.VEC4) {
        return out.value;
    }
    throw new Error(`Unsupported type: ${out.type}`);
}

async function renderGraphToCanvas(graphFn, outVec4Pin, width, height) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    canvas.width = width;
    canvas.height = height;

    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const u = x / (width - 1);
            const v = y / (height - 1);

            // Correct call signature
            const result = graphFn({ uv: [u, v], width: width, height: height });

            // Extract typed output
            const out = result[outVec4Pin];

            const [r, g, b, a] = resolveColor(result.out);

            const i = (y * width + x) * 4;

            data[i]     = Math.max(0, Math.min(255, r * 255));
            data[i + 1] = Math.max(0, Math.min(255, g * 255));
            data[i + 2] = Math.max(0, Math.min(255, b * 255));
            data[i + 3] = Math.max(0, Math.min(255, a * 255));
        }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
}
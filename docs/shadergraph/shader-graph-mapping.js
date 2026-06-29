class ShaderGraphNodeLibrary {
    constructor() {
        this.categories = {};
        this.nodeMap = new Map();
    }

    addCategory(key, { name, description }) {
        if (this.categories[key]) {
            throw new Error(`Category exists: ${key}`);
        }

        this.categories[key] = {
            name,
            description,
            nodes: []
        };
    }

    addNode(categoryKey, def) {
        const category = this.categories[categoryKey];
        if (!category) throw new Error(`Missing category: ${categoryKey}`);
        if (!def.type) throw new Error("Node must have type");

        if (this.nodeMap.has(def.type)) {
            throw new Error(`Duplicate node: ${def.type}`);
        }

        const node = {
            type: def.type,
            name: def.name,
            description: def.description || "",
            color: def.color || "#999",
            inputs: def.inputs || [],
            outputs: def.outputs || [],
            nodeData: def.nodeData || {},
            factory: def.factory
        };

        if (typeof node.factory !== "function") {
            throw new Error(`Node ${node.type} missing factory`);
        }

        category.nodes.push(node);
        this.nodeMap.set(node.type, node);
    }

    getNode(type) {
        return this.nodeMap.get(type);
    }

    createNode(type, data = {}, resources = {}) {
        const def = this.getNode(type);
        if (!def) throw new Error(`Unknown node type: ${type}`);

        return def.factory(data, resources);
    }

    buildVisualLibrary() {
        const categories = {};

        for (const [key, cat] of Object.entries(this.categories)) {
            categories[key] = {
                name: cat.name,
                description: cat.description,
                nodes: cat.nodes.map(n => ({
                    type: n.type,
                    name: n.name,
                    description: n.description,
                    color: n.color,
                    inputs: n.inputs,
                    outputs: n.outputs,
                    nodeData: structuredClone(n.nodeData)
                }))
            };
        }

        return new VisualNodeLibrary(categories);
    }
}

async function compileVisualGraph(visualGraph, resources, shaderLib) {
    const graph = new Graph();
    const nodeMap = new Map();

    // --- Instantiate ---
    for (const vNode of visualGraph.nodes) {
        if (!shaderLib.getNode(vNode.type)) {
            throw new Error(`Invalid node type: ${vNode.type}`);
        }

        const runtimeNode = shaderLib.createNode(
            vNode.type,
            vNode.nodeData,
            resources
        );

        nodeMap.set(vNode.id, graph.add(runtimeNode));
    }

    // --- Connect ---
    for (const conn of visualGraph.connections) {
        const from = nodeMap.get(conn.fromNode);
        const to = nodeMap.get(conn.toNode);

        if (!from || !to) {
            throw new Error("Invalid connection: missing node");
        }

        graph.connect(from, conn.fromPort, to, conn.toPort);
    }

    return graph;
}



const shaderLib = new ShaderGraphNodeLibrary();

shaderLib.addCategory("math", {
    name: "Math",
    description: "Math ops"
});

shaderLib.addCategory("texture", {
    name: "Texture",
    description: "Texture ops"
});

shaderLib.addNode("math", {
    type: "math.float",
    name: "Float",
    color: "#4CAF50",
    outputs: [{ name: "Value", type: "FLOAT" }],
    nodeData: { defaultValue: 1.0 },
    factory: (data) => new FloatNode(data.defaultValue)
});

shaderLib.addNode("texture", {
    type: "tex.image",
    name: "Image",
    color: "#E91E63",
    outputs: [
        { name: "tex", type: "TEXTURE" }
    ],
    nodeData: { resourceId: "player.png" },
    factory: (data, resources) => {
        if (!resources[data.resourceId]) {
            throw new Error(`Missing resource: ${data.resourceId}`);
        }
        return new ImageNode(resources[data.resourceId]);
    }
});
class VisualPort {
    constructor({ name, type }) {
        if (!name || !type) {
            throw new Error("Port must have name and type");
        }

        this.name = name;
        this.type = type;
    }
}

class VisualNodeDefinition {
    constructor({
        type,
        name,
        description,
        color,
        inputs = [],
        outputs = [],
        nodeData = {}
    }) {
        if (!type) throw new Error("Node missing type");

        this.type = type;
        this.name = name || type;
        this.description = description || "";
        this.color = color || "#999";

        this.inputs = inputs.map(p => new VisualPort(p));
        this.outputs = outputs.map(p => new VisualPort(p));

        this.nodeData = structuredClone(nodeData);
    }
}

class VisualCategory {
    constructor({ name, description, nodes = [] }) {
        this.name = name;
        this.description = description;
        this.nodes = nodes.map(n => new VisualNodeDefinition(n));
    }
}

class VisualNodeLibrary {
    constructor(categories) {
        this.categories = {};
        this.nodeMap = new Map();

        for (const [key, cat] of Object.entries(categories)) {
            const category = new VisualCategory(cat);
            this.categories[key] = category;

            for (const node of category.nodes) {
                if (this.nodeMap.has(node.type)) {
                    throw new Error(`Duplicate node type: ${node.type}`);
                }
                this.nodeMap.set(node.type, node);
            }
        }
    }

    getNode(type) {
        return this.nodeMap.get(type);
    }

    getDefaultNodeData(type) {
        const node = this.getNode(type);
        if (!node) throw new Error(`Unknown node: ${type}`);
        return structuredClone(node.nodeData);
    }
}


class VisualGraphEditor {
    constructor({ graphContainer, leftPanel, nodeLibrary }) {
        this.graphContainer = graphContainer;
        this.graph = new VisualGraph({
            container: graphContainer
        });

        this.graphEl = graphContainer.querySelector("#graph");
        this.leftPanel = leftPanel;

        this.nodeLibrary = nodeLibrary;

        this.nodes = [];
        this.connections = [];
        this.nextNodeId = 1;

        this.init();
    }

    // ================= INIT =================

    init() {
        this.buildNodeLibraryUI();
        this.setupDragDrop();
    }

    // ================= LIBRARY UI =================

    buildNodeLibraryUI() {
        this.leftPanel.innerHTML = "";

        for (const [key, category] of Object.entries(this.nodeLibrary.categories)) {
            const catDiv = document.createElement("div");
            catDiv.className = "category";

            const title = document.createElement("h3");
            title.textContent = category.name;
            catDiv.appendChild(title);

            category.nodes.forEach(node => {
                const item = document.createElement("div");
                item.className = "nodeItem";
                item.draggable = true;

                item.textContent = node.name;
                item.dataset.type = node.type;

                item.style.borderLeft = `4px solid ${node.color}`;
                item.title = node.description;

                item.addEventListener("dragstart", (e) => {
                    e.dataTransfer.setData("node/type", node.type);
                });

                catDiv.appendChild(item);
            });

            this.leftPanel.appendChild(catDiv);
        }
    }

    // ================= DRAG & DROP =================

    setupDragDrop() {
        this.graphEl.addEventListener("dragover", (e) => {
            e.preventDefault();
        });

        this.graphEl.addEventListener("drop", (e) => {
            e.preventDefault();

            const type = e.dataTransfer.getData("node/type");

            if (!type) {
                console.warn("No node type in drop");
                return;
            }

            const rect = this.graphEl.getBoundingClientRect();

            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            this.createNode(type, x, y);
        });
    }

    // ================= NODE CREATION =================

    createNode(type, x, y) {
        const def = this.nodeLibrary.getNode(type);

        return this.createNodeFromData({
            id: this.nextNodeId++,
            type,
            name: def.name,
            x,
            y,
            // TODO remove this
            nodeData: this.nodeLibrary.getDefaultNodeData(type)
        });
    }

    createNodeFromData(data) {
        const def = this.nodeLibrary.getNode(data.type);

        if (!def) {
            throw new Error(`Unknown node type: ${data.type}`);
        }

        const node = this.graph.createNode({
            id: data.id,
            name: data.name || def.name,
            x: data.x,
            y: data.y,
            inputs: data.inputs || def.inputs.map(p => ({ name: p.name, type: p.type })),
            outputs: data.outputs || def.outputs.map(p => ({ name: p.name, type: p.type }))
        });

        this.nodes.push({
            ...data
        });

        return node;
    }

    // ================= EXPORT =================

    serialize() {
        return {
            nodes: this.nodes.map(n => ({
                id: n.id,
                type: n.type,
                name: n.name,
                x: n.x,
                y: n.y,
                inputs: n.inputs,
                outputs: n.outputs,
                nodeData: n.nodeData || {}
            })),
            connections: this.connections
        };
    }

    load(serializedGraph) {
        // Reset editor state
        this.nodes = [];
        this.connections = [];
        this.nextNodeId = 1;

        // Let graph rebuild itself
        this.graph.load(serializedGraph, this.nodeLibrary);

        // Sync local state
        this.nodes = structuredClone(serializedGraph.nodes || []);
        this.connections = structuredClone(serializedGraph.connections || []);

        // Fix ID counter
        for (const node of this.nodes) {
            if (node.id >= this.nextNodeId) {
                this.nextNodeId = node.id + 1;
            }
        }
    }
}
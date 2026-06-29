class Vec2 {
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }

    add(v) { return new Vec2(this.x + v.x, this.y + v.y); }
    sub(v) { return new Vec2(this.x - v.x, this.y - v.y); }
    scale(s) { return new Vec2(this.x * s, this.y * s); }
}

// TODO
// - dont allow cyclic edges. Edges that create a cycle
// - ADD text elements to nodes (add to the json serialisation)

class VisualGraph {

    constructor({ container, saveData = null }) {
        // DOM
        this.container = container;
        this.viewport = container.querySelector("#viewport");
        this.graphEl = container.querySelector("#graph");
        this.grid = container.querySelector("#grid");

        // This is bad as wires render over pins and we cant interact with wires directly
        // Keep for performance but instead a good design is:
        // - one svg per wire under #graph
        // - then we can interact with events on a wire
        this.wiresSvg = container.querySelector("#wires");

        // STATE
        this.camera = { x: 0, y: 0, scale: 1 };

        this.nodes = [];
        this.connections = [];

        this.nodeIdCounter = 0;

        this.connectionsDirty = true;
        this.isPanning = false;
        this.lastMouse = new Vec2();
        this.activeNode = null;
        this.nodeDragOffset = new Vec2();
        this.draggingSelection = false;
        this.selectionDragStart = null;
        this.selectionDragNodes = [];
        this.draggingConnection = null;
        this.tempPath = null;

        this.selectedNodes = new Set();
        this.clipboard = null;
        this.isSelecting = false;
        this.selectionMode = "replace";
        this.selectionStart = null;
        this.selectionBoxEl = null;

        this.init();

        if (saveData) {
            this.deserialize(saveData);
        }
    }

    init() {
        this.startRenderLoop();
        this.bindEvents();
    }

    bindEvents() {
        this.viewport.addEventListener("contextmenu", this.onViewportContextMenu.bind(this));
        this.viewport.addEventListener("mousedown", this.onViewportMouseDown.bind(this));
        window.addEventListener("mousemove", this.onWindowMouseMove.bind(this));
        window.addEventListener("mouseup", this.onWindowMouseUp.bind(this));
        this.viewport.addEventListener("wheel", this.onViewportWheel.bind(this), { passive: false });
        window.addEventListener("keydown", this.onWindowKeyDown.bind(this));
    }

    onViewportContextMenu(e) {
        e.preventDefault();
    }

    onViewportMouseDown(e) {
        if (e.button === 0) {
            if (!e.target.closest(".node")) {
                if (!e.shiftKey && !e.ctrlKey) {
                    this.clearSelection();
                }

                this.selectionMode = e.shiftKey ? "add" : e.ctrlKey ? "remove" : "replace";
                this.startSelectionBox(e);
            }
            return;
        }

        if (e.button === 2 && !this.isInsideNode(e.target)) {
            this.startPan(e);
        }
    }

    onWindowMouseMove(e) {
        if (this.isSelecting) {
            this.updateSelectionBox(e);
        }

        if (this.isPanning) {
            this.updatePan(e);
        }

        if (this.activeNode) {
            this.updateNodeDrag(e);
        }

        if (this.draggingConnection) {
            this.drawTempWire(e.clientX, e.clientY);
        }
    }

    onWindowMouseUp(e) {
        if (this.isSelecting) {
            this.stopSelectionBox();
        }

        if (e.button === 2) {
            this.stopPan();
        } else {
            this.stopPan();
        }

        if (this.activeNode) {
            this.activeNode = null;
            this.draggingSelection = false;
            this.selectionDragStart = null;
            this.selectionDragNodes = [];
        }

        if (this.draggingConnection) {
            this.completeConnection(e);
        }
    }

    onViewportWheel(e) {
        e.preventDefault();
        this.zoomGraph(e);
    }

    onWindowKeyDown(e) {
        if (e.ctrlKey && e.key === "0") {
            e.preventDefault();
            this.camera.scale = 1;
            this.updateTransform();
        }

        if (e.ctrlKey && e.code === "Space") {
            e.preventDefault();
            this.camera.x = 0;
            this.camera.y = 0;
            this.updateTransform();
        }

        if (e.ctrlKey && e.key.toLowerCase() === "c") {
            e.preventDefault();
            this.copySelection();
        }

        if (e.ctrlKey && e.key.toLowerCase() === "v") {
            e.preventDefault();
            this.pasteClipboard();
        }
    }

    startPan(e) {
        this.isPanning = true;
        this.viewport.classList.add("dragging");
        this.lastMouse = new Vec2(e.clientX, e.clientY);
    }

    updatePan(e) {
        const current = new Vec2(e.clientX, e.clientY);
        const delta = current.sub(this.lastMouse);

        this.camera.x += delta.x;
        this.camera.y += delta.y;
        this.lastMouse = current;

        this.updateTransform();
    }

    stopPan() {
        this.isPanning = false;
        this.viewport.classList.remove("dragging");
    }

    updateNodeDrag(e) {
        const mouse = this.screenToWorld(this.clientToScreen(new Vec2(e.clientX, e.clientY)));

        if (this.draggingSelection && this.selectionDragStart) {
            const delta = mouse.sub(this.selectionDragStart);
            this.selectionDragNodes.forEach(({ element, startPos }) => {
                element.style.left = startPos.x + delta.x + "px";
                element.style.top = startPos.y + delta.y + "px";
            });
        } else {
            const pos = mouse.sub(this.nodeDragOffset);
            this.activeNode.style.left = pos.x + "px";
            this.activeNode.style.top = pos.y + "px";
        }

        this.requestConnectionRedraw();
    }

    stopSelectionBox() {
        this.isSelecting = false;
        if (this.selectionBoxEl) {
            this.selectionBoxEl.remove();
            this.selectionBoxEl = null;
        }
    }

    completeConnection(e) {
        const target = document.elementFromPoint(e.clientX, e.clientY);
        const pin = target?.closest(".pinCircle");

        if (pin) {
            const valid =
                pin.dataset.nodeId !== this.draggingConnection.fromNode &&
                pin.dataset.direction !== this.draggingConnection.fromDir &&
                pin.dataset.pinType === this.draggingConnection.fromType;

            if (valid) {
                this.createConnection({
                    fromNode: this.draggingConnection.fromNode,
                    fromPin: this.draggingConnection.fromPin,
                    toNode: pin.dataset.nodeId,
                    toPin: pin.dataset.pinName
                });
            }
        }

        this.draggingConnection = null;
        this.clearTempWire();
    }

    zoomGraph(e) {
        const MIN_ZOOM = 0.2;
        const MAX_ZOOM = 3;
        const zoomIntensity = 0.001;
        const zoomFactor = 1 + (-e.deltaY * zoomIntensity);

        const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.camera.scale * zoomFactor));
        const mouseScreen = this.clientToScreen(new Vec2(e.clientX, e.clientY));
        const worldBefore = this.screenToWorld(mouseScreen);

        this.camera.scale = newScale;
        const worldAfter = this.worldToScreen(worldBefore);

        this.camera.x += mouseScreen.x - worldAfter.x;
        this.camera.y += mouseScreen.y - worldAfter.y;

        this.updateTransform();
    }

    screenToWorld(screen) {
        return new Vec2(
            (screen.x - this.camera.x) / this.camera.scale,
            (screen.y - this.camera.y) / this.camera.scale
        );
    }

    worldToScreen(world) {
        return new Vec2(
            world.x * this.camera.scale + this.camera.x,
            world.y * this.camera.scale + this.camera.y
        );
    }

    clientToScreen(client) {
        const rect = this.viewport.getBoundingClientRect();
        return new Vec2(
            client.x - rect.left,
            client.y - rect.top
        );
    }

    isInsideNode(target) {
        return target.closest(".node") !== null;
    }

    startRenderLoop() {
        const loop = () => {
            if (this.connectionsDirty) {
                this.updateConnections();
                this.connectionsDirty = false;
            }
            requestAnimationFrame(loop);
        };
        loop();
    }

    updateTransform() {
        const t = `translate(${this.camera.x}px, ${this.camera.y}px) scale(${this.camera.scale})`;
        this.graphEl.style.transform = t;
        this.grid.style.transform = t;

        this.requestConnectionRedraw();
    }

    requestConnectionRedraw() {
        this.connectionsDirty = true;
    }

    createNode(data) {
        const {
            id = null,
            name,
            inputs = [],
            outputs = [],
            x = 0,
            y = 0
        } = data;

        const nodeId = id ?? this.nodeIdCounter++;
        this.nodeIdCounter = Math.max(this.nodeIdCounter, nodeId + 1);

        const el = document.createElement("div");
        el.className = "node";
        el.dataset.nodeId = nodeId;

        el.style.left = x + "px";
        el.style.top = y + "px";

        el.innerHTML = `
            <div class="nodeHeader">${name}</div>
            <div class="nodeBody">
                <div class="inputs"></div>
                <div class="outputs"></div>
            </div>
        `;

        const inputsEl = el.querySelector(".inputs");
        const outputsEl = el.querySelector(".outputs");

        inputs.forEach(pin => inputsEl.appendChild(this.createPin(nodeId, pin, "in")));
        outputs.forEach(pin => outputsEl.appendChild(this.createPin(nodeId, pin, "out")));

        el.addEventListener("mousedown", (e) => {
            // Prevent pan + selection box
            e.stopPropagation();

            const nodeEl = el;

            if (e.ctrlKey) {
                this.toggleSelection(nodeEl);
            } else if (e.shiftKey) {
                this.setSelection([nodeEl], "add");
            } else {
                this.setSelection([nodeEl], "replace");
            }
        });

        this.enableNodeDrag(el);

        this.graphEl.appendChild(el);

        const node = {
            id: nodeId,
            name,
            inputs,
            outputs,
            element: el
        };

        this.nodes.push(node);

        this.requestConnectionRedraw();

        return node;
    }

    getNodeByElement(element) {
        return this.nodes.find(n => n.element === element) || null;
    }

    copySelection() {
        const selected = Array.from(this.selectedNodes)
            .map(el => this.getNodeByElement(el))
            .filter(Boolean);

        if (selected.length === 0) {
            this.clipboard = null;
            return;
        }

        const ids = new Set(selected.map(n => n.id));
        const nodes = selected.map(n => ({
            id: n.id,
            name: n.name,
            x: parseFloat(n.element.style.left),
            y: parseFloat(n.element.style.top),
            inputs: JSON.parse(JSON.stringify(n.inputs)),
            outputs: JSON.parse(JSON.stringify(n.outputs))
        }));

        const connections = this.connections
            .filter(c => ids.has(Number(c.fromNode)) && ids.has(Number(c.toNode)))
            .map(c => ({
                fromNode: Number(c.fromNode),
                fromPin: c.fromPin,
                toNode: Number(c.toNode),
                toPin: c.toPin
            }));

        this.clipboard = { nodes, connections };
    }

    pasteClipboard() {
        if (!this.clipboard) return;

        const idMap = new Map();
        const pastedNodes = this.clipboard.nodes.map(node => {
            const pasted = this.createNode({
                name: node.name,
                inputs: JSON.parse(JSON.stringify(node.inputs)),
                outputs: JSON.parse(JSON.stringify(node.outputs)),
                x: node.x + 20,
                y: node.y + 20
            });
            idMap.set(node.id, pasted.id);
            return pasted;
        });

        this.clipboard.connections.forEach(conn => {
            const toNode = idMap.get(conn.toNode);
            const fromNode = idMap.get(conn.fromNode);
            if (fromNode != null && toNode != null) {
                this.createConnection({
                    fromNode,
                    fromPin: conn.fromPin,
                    toNode,
                    toPin: conn.toPin
                });
            }
        });

        this.setSelection(pastedNodes.map(n => n.element), "replace");
    }

    createPin(nodeId, pin, direction) {
        const el = document.createElement("div");
        el.className = "pin";

        const circle = document.createElement("div");
        circle.className = `pinCircle type-${(pin.type || "default").toLowerCase()}`;

        circle.dataset.nodeId = nodeId;
        circle.dataset.pinName = pin.name;
        circle.dataset.pinType = pin.type;
        circle.dataset.direction = direction;

        const label = document.createElement("span");
        label.textContent = pin.name;


        el.classList.add(direction); // "in" or "out"
        el.append(circle, label);
        /*if (direction === "in") {
            el.append(circle, label);
        } else {
            el.append(circle, label);
        }*/

        this.enablePinDrag(circle);
        this.enablePinClick(circle);
        return el;
    }

    enablePinDrag(pinEl) {
        pinEl.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            e.preventDefault();

            this.draggingConnection = {
                fromNode: pinEl.dataset.nodeId,
                fromPin: pinEl.dataset.pinName,
                fromType: pinEl.dataset.pinType,
                fromDir: pinEl.dataset.direction
            };
        });
    }

    enablePinClick(pinEl) {
        pinEl.addEventListener("click", (e) => {
            if (e.altKey) {
                e.stopPropagation();
                this.removeConnectionsForPin(pinEl);
            }
        });
    }

    removeConnectionsForPin(pinEl) {
        const nodeId = pinEl.dataset.nodeId;
        const pinName = pinEl.dataset.pinName;

        const toRemove = this.connections.filter(conn =>
            (conn.fromNode == nodeId && conn.fromPin === pinName) ||
            (conn.toNode == nodeId && conn.toPin === pinName)
        );

        toRemove.forEach(conn => this.removeConnection(conn));
    }

    enableNodeDrag(node) {
        const header = node.querySelector(".nodeHeader");

        header.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            if (e.shiftKey || e.ctrlKey) return;
            e.stopPropagation();

            const mouse = this.screenToWorld(this.clientToScreen(new Vec2(e.clientX, e.clientY)));
            const nodePos = new Vec2(
                parseFloat(node.style.left),
                parseFloat(node.style.top)
            );

            this.nodeDragOffset = mouse.sub(nodePos);
            this.activeNode = node;

            const isSelectedNode = this.selectedNodes.has(node);
            if (isSelectedNode && this.selectedNodes.size > 1) {
                this.draggingSelection = true;
                this.selectionDragStart = mouse;
                this.selectionDragNodes = Array.from(this.selectedNodes)
                    .map(el => ({
                        element: el,
                        startPos: new Vec2(
                            parseFloat(el.style.left),
                            parseFloat(el.style.top)
                        )
                    }));
            } else {
                this.draggingSelection = false;
                this.selectionDragStart = null;
                this.selectionDragNodes = [];
            }
        });
    }

    findPin(nodeId, pinName) {
        const node = this.graphEl.querySelector(`[data-node-id="${nodeId}"]`);
        return node?.querySelector(`[data-pin-name="${pinName}"]`);
    }

    getPinWorldPosition(pinEl) {
        const rect = pinEl.getBoundingClientRect();
        const vpRect = this.viewport.getBoundingClientRect();

        const screen = new Vec2(
            rect.left - vpRect.left + rect.width / 2,
            rect.top - vpRect.top + rect.height / 2
        );

        return this.screenToWorld(screen);
    }

    updateConnections() {
        this.connections.forEach(conn => {
            const fromPin = this.findPin(conn.fromNode, conn.fromPin);
            const toPin = this.findPin(conn.toNode, conn.toPin);

            if (!fromPin || !toPin) return;

            const a = this.worldToScreen(this.getPinWorldPosition(fromPin));
            const b = this.worldToScreen(this.getPinWorldPosition(toPin));

            const fromSide = this.getPinSide(fromPin);
            const toSide = this.getPinSide(toPin);

            conn.element.setAttribute(
                "d",
                this.buildCurve(a, b, fromSide, toSide)
            );
        });
    }

    buildCurve(a, b, fromSide, toSide) {
        const offset = Math.max(50, Math.abs(b.x - a.x) * 0.5);

        const c1x = fromSide === "right" ? a.x + offset : a.x - offset;
        const c2x = toSide === "right" ? b.x + offset : b.x - offset;

        return `M ${a.x} ${a.y}
                C ${c1x} ${a.y},
                ${c2x} ${b.y},
                ${b.x} ${b.y}`;
    }

    drawTempWire(clientX, clientY) {
        if (this.tempPath) this.tempPath.remove();

        this.tempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");

        const startPin = this.findPin(
            this.draggingConnection.fromNode,
            this.draggingConnection.fromPin
        );
        if (!startPin) return;

        const a = this.worldToScreen(this.getPinWorldPosition(startPin));
        const b = this.clientToScreen(new Vec2(clientX, clientY));

        const fromSide = this.getPinSide(startPin);

        // Decide a virtual "side" for the mouse:
        // If mouse is right of start -> treat as right, else left
        const toSide = b.x <= a.x ? "right" : "left";

        this.tempPath.setAttribute(
            "d",
            this.buildCurve(a, b, fromSide, toSide)
        );

        this.tempPath.setAttribute("stroke", "#aaa");
        this.tempPath.setAttribute("fill", "none");

        this.wiresSvg.appendChild(this.tempPath);
    }

    clearTempWire() {
        if (this.tempPath) {
            this.tempPath.remove();
            this.tempPath = null;
        }
    }

    createConnection(data) {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

        path.setAttribute("stroke", "#888");
        path.setAttribute("fill", "none");

        const conn = { ...data, element: path };

        path.addEventListener("click", (e) => {
            if (e.altKey) this.removeConnection(conn);
        });

        this.connections.push(conn);
        this.wiresSvg.appendChild(path);
        this.requestConnectionRedraw();

        return conn;
    }

    // --------------------
    // Extra helper methods
    // --------------------

    getPinSide(pinEl) {
        const pinRect = pinEl.getBoundingClientRect();
        const nodeRect = pinEl.closest(".node").getBoundingClientRect();

        const pinCenterX = pinRect.left + pinRect.width / 2;
        const nodeCenterX = nodeRect.left + nodeRect.width / 2;

        return pinCenterX < nodeCenterX ? "left" : "right";
    }

    getNodeWorldCenterX(nodeId) {
        const nodeEl = this.graphEl.querySelector(`[data-node-id="${nodeId}"]`);
        if (!nodeEl) return 0;

        const rect = nodeEl.getBoundingClientRect();
        const vpRect = this.viewport.getBoundingClientRect();

        const screenX = rect.left - vpRect.left + rect.width / 2;

        return this.screenToWorld(new Vec2(screenX, 0)).x;
    }

    removeConnection(conn) {
        const i = this.connections.indexOf(conn);
        if (i !== -1) this.connections.splice(i, 1);
        conn.element.remove();
    }

    // == SELECTION ==

    setSelection(nodes, mode = "replace") {
        if (mode === "replace") {
            this.selectedNodes.clear();
        }

        nodes.forEach(n => this.selectedNodes.add(n));

        this.updateSelectionUI();
    }

    toggleSelection(node) {
        if (this.selectedNodes.has(node)) {
            this.selectedNodes.delete(node);
        } else {
            this.selectedNodes.add(node);
        }
        this.updateSelectionUI();
    }

    clearSelection() {
        this.selectedNodes.clear();
        this.updateSelectionUI();
    }

    updateSelectionUI() {
        this.nodes.forEach(n => {
            if (this.selectedNodes.has(n.element)) {
                n.element.classList.add("selected");
            } else {
                n.element.classList.remove("selected");
            }
        });
    }

    startSelectionBox(e) {
        this.isSelecting = true;

        const rect = this.viewport.getBoundingClientRect();

        this.selectionStart = new Vec2(
            e.clientX - rect.left,
            e.clientY - rect.top
        );

        this.selectionBoxEl = document.createElement("div");
        this.selectionBoxEl.className = "selection-box";
        this.selectionBoxEl.style.left = this.selectionStart.x + "px";
        this.selectionBoxEl.style.top = this.selectionStart.y + "px";

        this.viewport.appendChild(this.selectionBoxEl);
    }

    updateSelectionBox(e) {
        const rect = this.viewport.getBoundingClientRect();

        const current = new Vec2(
            e.clientX - rect.left,
            e.clientY - rect.top
        );

        const x = Math.min(this.selectionStart.x, current.x);
        const y = Math.min(this.selectionStart.y, current.y);
        const w = Math.abs(this.selectionStart.x - current.x);
        const h = Math.abs(this.selectionStart.y - current.y);

        Object.assign(this.selectionBoxEl.style, {
            left: x + "px",
            top: y + "px",
            width: w + "px",
            height: h + "px"
        });

        this.updateSelectionFromBox(x, y, w, h);
    }

    updateSelectionFromBox(x, y, w, h) {
        const box = this.selectionBoxEl.getBoundingClientRect();

        const newlySelected = [];

        this.nodes.forEach(n => {
            const rect = n.element.getBoundingClientRect();

            const intersects =
                rect.left < box.right &&
                rect.right > box.left &&
                rect.top < box.bottom &&
                rect.bottom > box.top;

            if (intersects) {
                newlySelected.push(n.element);
            }
        });

        if (this.selectionMode === "replace") {
            this.setSelection(newlySelected, "replace");
        } else if (this.selectionMode === "add") {
            this.setSelection(newlySelected, "add");
        } else if (this.selectionMode === "remove") {
            newlySelected.forEach(nodeEl => this.selectedNodes.delete(nodeEl));
            this.updateSelectionUI();
        }
    }

    // == SERIALISATION ==

    /**
     * Serialise this graph into a map object
     * @returns a map that matches export json
     */
    serialize() {
        return {
            camera: { ...this.camera },

            nodes: this.nodes.map(n => ({
                id: n.id,
                name: n.name,
                x: parseFloat(n.element.style.left),
                y: parseFloat(n.element.style.top),
                inputs: n.inputs,
                outputs: n.outputs
            })),

            connections: this.connections.map(c => ({
                fromNode: Number(c.fromNode),
                fromPin: c.fromPin,
                toNode: Number(c.toNode),
                toPin: c.toPin
            }))
        };
    }

    /**
     * Takes in a map (serialised graph) and clears and loads that graph.
     * No merging as ID's will need to be modified.
     * 
     * @param {*Map} data 
     */
    deserialize(data) {
        if (typeof data === "string") data = JSON.parse(data);

        this.clear();

        // camera
        Object.assign(this.camera, data.camera);
        this.updateTransform();

        // nodes
        data.nodes.forEach(n => this.createNode(n));

        // connections
        data.connections.forEach(c => this.createConnection(c));

        this.requestConnectionRedraw();
    }

    clear() {
        this.nodes.forEach(n => n.element.remove());
        this.connections.forEach(c => c.element.remove());

        this.nodes = [];
        this.connections = [];

        this.nodeIdCounter = 0;
    }

    save() {
        return JSON.stringify(this.serialize(), null, 2);
    }

    load(json) {
        this.deserialize(json);
    }
}
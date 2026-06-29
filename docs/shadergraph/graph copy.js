const container = document.getElementById("graph-container");
const viewport = document.getElementById("viewport");
const graph = document.getElementById("graph");
const grid = document.getElementById("grid");
const wiresSvg = document.getElementById("wires");

// -------------------------
// VEC2
// -------------------------
class Vec2 {
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }

    add(v) { return new Vec2(this.x + v.x, this.y + v.y); }
    sub(v) { return new Vec2(this.x - v.x, this.y - v.y); }
    scale(s) { return new Vec2(this.x * s, this.y * s); }
}

// -------------------------
// CAMERA
// -------------------------
let camera = {
    x: 0,
    y: 0,
    scale: 1
};

function screenToWorld(screen) {
    return new Vec2(
        (screen.x - camera.x) / camera.scale,
        (screen.y - camera.y) / camera.scale
    );
}

function worldToScreen(world) {
    return new Vec2(
        world.x * camera.scale + camera.x,
        world.y * camera.scale + camera.y
    );
}

function clientToScreen(client) {
    const rect = viewport.getBoundingClientRect();
    return new Vec2(
        client.x - rect.left,
        client.y - rect.top
    );
}

// -------------------------
// CONNECTIONS
// -------------------------
let connections = [];

let connectionsDirty = true;

function requestConnectionRedraw() {
    connectionsDirty = true;
}

function renderLoop() {
    if (connectionsDirty) {
        updateConnections();
        connectionsDirty = false;
    }
    requestAnimationFrame(renderLoop);
}
renderLoop();

// -------------------------
// CAMERA TRANSFORM
// -------------------------
function updateTransform() {
    const transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
    graph.style.transform = transform;
    grid.style.transform = transform;

    requestConnectionRedraw();
}

// -------------------------
// PAN
// -------------------------
let isPanning = false;
let lastMouse = new Vec2();

function isInsideNode(target) {
    return target.closest(".node") !== null;
}

viewport.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (isInsideNode(e.target)) return;

    isPanning = true;
    viewport.classList.add("dragging");
    lastMouse = new Vec2(e.clientX, e.clientY);
});

window.addEventListener("mousemove", (e) => {
    if (!isPanning) return;

    const current = new Vec2(e.clientX, e.clientY);
    const delta = current.sub(lastMouse);

    camera.x += delta.x;
    camera.y += delta.y;

    lastMouse = current;

    updateTransform();
});

window.addEventListener("mouseup", () => {
    isPanning = false;
    viewport.classList.remove("dragging");
});

// -------------------------
// ZOOM
// -------------------------
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;

viewport.addEventListener("wheel", (e) => {
    e.preventDefault();

    const zoomIntensity = 0.001;
    const zoomFactor = 1 + (-e.deltaY * zoomIntensity);

    const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.scale * zoomFactor));

    const mouseScreen = clientToScreen(new Vec2(e.clientX, e.clientY));
    const worldBefore = screenToWorld(mouseScreen);

    camera.scale = newScale;

    const worldAfter = worldToScreen(worldBefore);

    camera.x += mouseScreen.x - worldAfter.x;
    camera.y += mouseScreen.y - worldAfter.y;

    updateTransform();
}, { passive: false });

// -------------------------
// SHORTCUTS
// -------------------------
window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "0") {
        e.preventDefault();
        camera.scale = 1;
        updateTransform();
    }

    if (e.ctrlKey && e.code === "Space") {
        e.preventDefault();
        camera.x = 0;
        camera.y = 0;
        updateTransform();
    }
});

// -------------------- NODE --------------------
let nodeIdCounter = 0;

function createNode({ id = null, name, inputs = [], outputs = [], x = 100, y = 100 }) {
    if (id === null) id = nodeIdCounter++;
    else nodeIdCounter = Math.max(nodeIdCounter, id + 1);

    const node = document.createElement("div");
    node.className = "node";
    node.dataset.nodeId = id;

    node.style.left = x + "px";
    node.style.top = y + "px";

    node.innerHTML = `
        <div class="nodeHeader">${name}</div>
        <div class="nodeBody">
            <div class="inputs"></div>
            <div class="outputs"></div>
        </div>
    `;

    const inputsEl = node.querySelector(".inputs");
    const outputsEl = node.querySelector(".outputs");

    inputs.forEach(pin => inputsEl.appendChild(createPin(id, pin, "in")));
    outputs.forEach(pin => outputsEl.appendChild(createPin(id, pin, "out")));

    enableNodeDrag(node);
    graph.appendChild(node);

    // STORE MODEL
    nodes.push({ id, name, inputs, outputs, element: node });

    requestConnectionRedraw();
}

function serializeGraph() {
    return JSON.stringify({
        camera: { ...camera },

        nodes: nodes.map(n => ({
            id: n.id,
            name: n.name,
            x: parseFloat(n.element.style.left),
            y: parseFloat(n.element.style.top),
            inputs: n.inputs,
            outputs: n.outputs
        })),

        connections: connections.map(c => ({
            fromNode: Number(c.fromNode),
            fromPin: c.fromPin,
            toNode: Number(c.toNode),
            toPin: c.toPin
        }))
    }, null, 2);
}

function clearGraph() {
    // remove nodes
    nodes.forEach(n => n.element.remove());
    nodes = [];

    // remove connections
    connections.forEach(c => c.element.remove());
    connections = [];

    nodeIdCounter = 0;
}

function deserializeGraph(json) {
    const data = typeof json === "string" ? JSON.parse(json) : json;

    clearGraph();

    // restore camera
    camera.x = data.camera.x;
    camera.y = data.camera.y;
    camera.scale = data.camera.scale;
    updateTransform();

    // recreate nodes
    data.nodes.forEach(n => {
        createNode({
            id: n.id,
            name: n.name,
            inputs: n.inputs,
            outputs: n.outputs,
            x: n.x,
            y: n.y
        });
    });

    // recreate connections
    data.connections.forEach(c => {
        createConnection({
            fromNode: c.fromNode,
            fromPin: c.fromPin,
            toNode: c.toNode,
            toPin: c.toPin
        });
    });

    requestConnectionRedraw();
}

// -------------------- PIN --------------------
function createPin(nodeId, pin, direction) {
    const el = document.createElement("div");
    el.className = "pin";

    const circle = document.createElement("div");
    circle.className = `pinCircle type-${pin.type.toLowerCase()}`;

    circle.dataset.nodeId = nodeId;
    circle.dataset.pinName = pin.name;
    circle.dataset.pinType = pin.type;
    circle.dataset.direction = direction;

    const label = document.createElement("span");
    label.textContent = pin.name;

    if (direction === "in") {
        el.append(circle, label);
    } else {
        el.append(label, circle);
    }

    enablePinDrag(circle);
    return el;
}

// -------------------- CONNECTION SYSTEM --------------------
let draggingConnection = null;

function enablePinDrag(pinEl) {
    pinEl.addEventListener("mousedown", (e) => {
        e.stopPropagation();

        draggingConnection = {
            fromNode: pinEl.dataset.nodeId,
            fromPin: pinEl.dataset.pinName,
            fromType: pinEl.dataset.pinType,
            fromDir: pinEl.dataset.direction
        };
    });
}

function createConnection(data) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

    path.setAttribute("stroke", "#888");
    path.setAttribute("fill", "none");

    const connection = { ...data, element: path };

    path.addEventListener("click", (e) => {
        if (e.altKey) removeConnection(connection);
    });

    connections.push(connection);
    wiresSvg.appendChild(path);

    return connection;
}

function removeConnection(connection) {
    const i = connections.indexOf(connection);
    if (i !== -1) connections.splice(i, 1);
    connection.element.remove();
}

// -------------------- EVENTS --------------------
window.addEventListener("mousemove", (e) => {
    if (!draggingConnection) return;
    drawTempWire(e.clientX, e.clientY);
});

window.addEventListener("mouseup", (e) => {
    if (!draggingConnection) return;

    const target = document.elementFromPoint(e.clientX, e.clientY);
    const pin = target?.closest?.(".pinCircle");

    if (pin) {
        const valid =
            pin.dataset.nodeId !== draggingConnection.fromNode &&
            pin.dataset.direction !== draggingConnection.fromDir &&
            pin.dataset.pinType === draggingConnection.fromType;

        if (valid) {
            createConnection({
                fromNode: draggingConnection.fromNode,
                fromPin: draggingConnection.fromPin,
                toNode: pin.dataset.nodeId,
                toPin: pin.dataset.pinName
            });

            requestConnectionRedraw();
        }
    }

    draggingConnection = null;
    clearTempWire();
});

// -------------------- WIRES --------------------
function getPinWorldPosition(pinEl) {
    const rect = pinEl.getBoundingClientRect();
    const vpRect = viewport.getBoundingClientRect();

    const screen = new Vec2(
        rect.left - vpRect.left + rect.width / 2,
        rect.top - vpRect.top + rect.height / 2
    );

    return screenToWorld(screen);
}

function updateConnections() {
    connections.forEach(conn => {
        const fromPin = findPin(conn.fromNode, conn.fromPin);
        const toPin = findPin(conn.toNode, conn.toPin);

        if (!fromPin || !toPin) return;

        const a = worldToScreen(getPinWorldPosition(fromPin));
        const b = worldToScreen(getPinWorldPosition(toPin));

        const dx = Math.abs(b.x - a.x) * 0.5;

        conn.element.setAttribute("d",
            `M ${a.x} ${a.y}
             C ${a.x + dx} ${a.y},
               ${b.x - dx} ${b.y},
               ${b.x} ${b.y}`
        );
    });
}

function findPin(nodeId, pinName) {
    const node = document.querySelector(`[data-node-id="${nodeId}"]`);
    return node?.querySelector(`[data-pin-name="${pinName}"]`);
}

// -------------------- TEMP WIRE --------------------
let tempPath = null;

function drawTempWire(clientX, clientY) {
    if (tempPath) tempPath.remove();

    tempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");

    const startPin = findPin(draggingConnection.fromNode, draggingConnection.fromPin);

    const a = worldToScreen(getPinWorldPosition(startPin));
    const b = clientToScreen(new Vec2(clientX, clientY));

    const dx = Math.abs(b.x - a.x) * 0.5;

    tempPath.setAttribute("d",
        `M ${a.x} ${a.y}
         C ${a.x + dx} ${a.y},
           ${b.x - dx} ${b.y},
           ${b.x} ${b.y}`
    );

    tempPath.setAttribute("stroke", "#aaa");
    tempPath.setAttribute("fill", "none");

    wiresSvg.appendChild(tempPath);
}

function clearTempWire() {
    if (tempPath) {
        tempPath.remove();
        tempPath = null;
    }
}

// -------------------- NODE DRAGGING --------------------
function enableNodeDrag(node) {
    let dragging = false;
    let offset = new Vec2();

    const header = node.querySelector(".nodeHeader");

    header.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        dragging = true;

        const mouse = screenToWorld(clientToScreen(new Vec2(e.clientX, e.clientY)));
        const nodePos = new Vec2(
            parseFloat(node.style.left),
            parseFloat(node.style.top)
        );

        offset = mouse.sub(nodePos);
    });

    window.addEventListener("mousemove", (e) => {
        if (!dragging) return;

        const mouse = screenToWorld(clientToScreen(new Vec2(e.clientX, e.clientY)));
        const pos = mouse.sub(offset);

        node.style.left = pos.x + "px";
        node.style.top = pos.y + "px";

        requestConnectionRedraw();
    });

    window.addEventListener("mouseup", () => dragging = false);
}

// -------------------------
// DEMO
// -------------------------
createNode({
    name: "Float Node",
    outputs: [{ name: "Value", type: "FLOAT" }],
    x: 200,
    y: 200
});

createNode({
    name: "Vec2 Node",
    inputs: [{ name: "A", type: "VEC2" }],
    outputs: [{ name: "Out", type: "VEC2" }],
    x: 500,
    y: 300
});

updateTransform();
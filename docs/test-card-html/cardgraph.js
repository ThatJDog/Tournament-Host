import "shadergraph.js";

const graph = new Graph();

// Nodes
const img1 = graph.add(new ImageNode("img1", textureA));
const img2 = graph.add(new ImageNode("img2", textureB));

const blend = graph.add(new MultiplyNode("mul", "img1", "img2"));

const output = "mul";

// Evaluate
const result = graph.evaluate(output, {
  width: 512,
  height: 512
});

// Use result
document.body.appendChild(result);
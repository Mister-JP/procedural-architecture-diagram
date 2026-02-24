import { ELEMENT_TYPES } from "../schema.js";
import { TensorElement } from "./TensorElement.js";
import { ArrowElement } from "./ArrowElement.js";
import { LabelElement } from "./LabelElement.js";

export function createElementInstance(config) {
  if (config.type === ELEMENT_TYPES.tensor) {
    return new TensorElement(config);
  }

  if (config.type === ELEMENT_TYPES.arrow) {
    return new ArrowElement(config);
  }

  if (config.type === ELEMENT_TYPES.label) {
    return new LabelElement(config);
  }

  throw new Error(`Unsupported element type: ${config.type}`);
}

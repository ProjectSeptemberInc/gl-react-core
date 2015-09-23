const invariant = require("invariant");
const TextureObjects = require("./TextureObjects");
const isNonSamplerUniformValue = require("./isNonSamplerUniformValue");

//// build: converts the VDOM gl-react DSL into an internal data tree.

module.exports = function (React, Shaders, Uniform, GLComponent, GLView) {
  // FIXME: maybe with React 0.14, we will be able to make this library depending on React so we don't have to do this closure

  function pickReactFirstChild (children) {
    return React.Children.count(children) === 1 ?
      (children instanceof Array ? children[0] : children) :
      null;
  }

  function unfoldGLComponent (c) { // FIXME: React might eventually improve to ease the work done here. see https://github.com/facebook/react/issues/4697#issuecomment-134335822
    const instance = new c.type();
    if (!(instance instanceof GLComponent)) return; // FIXME: can we check this without instanciating it?
    instance.props = c.props;
    return pickReactFirstChild(instance.render());
  }

  function findGLViewInGLComponentChildren (children) {
    // going down the VDOM tree, while we can unfold GLComponent
    for (let c = children; c && typeof c.type === "function"; c = unfoldGLComponent(c))
      if (c.type === GLView)
        return c; // found a GLView
  }

  return function build (shader, glViewUniforms, width, height, glViewChildren, preload) {
    invariant(Shaders.exists(shader), "Shader #%s does not exists", shader);

    const shaderName = Shaders.getName(shader);

    const uniforms = { ...glViewUniforms };
    const children = [];
    const contents = [];

    React.Children.forEach(glViewChildren, child => {
      invariant(child.type === Uniform, "(Shader '%s') GL.View can only contains children of type GL.Uniform. Got '%s'", shaderName, child.type && child.type.displayName || child);
      const { name, children, ...opts } = child.props;
      invariant(typeof name === "string" && name, "(Shader '%s') GL.Uniform must define an name String", shaderName);
      invariant(!glViewUniforms || !(name in glViewUniforms), "(Shader '%s') The uniform '%s' set by GL.Uniform must not be in {uniforms} props", shaderName);
      invariant(!(name in uniforms), "(Shader '%s') The uniform '%s' set by GL.Uniform must not be defined in another GL.Uniform", shaderName);
      uniforms[name] = !children || children.value ? children : { value: children, opts }; // eslint-disable-line no-undef
    });

    Object.keys(uniforms).forEach(name => {
      let value = uniforms[name];
      if (isNonSamplerUniformValue(value)) return;

      let opts, typ = typeof value;

      if (value && typ === "object" && !value.prototype && "value" in value) {
        // if value has a value field, we tread this field as the value, but keep opts in memory if provided
        if (typeof value.opts === "object") {
          opts = value.opts;
        }
        value = value.value;
        typ = typeof value;
      }

      if (!value) {
        // falsy value are accepted to indicate blank texture
        uniforms[name] = value;
      }
      else if (typ === "string") {
        // uri specified as a string
        uniforms[name] = TextureObjects.withOpts(TextureObjects.URI({ uri: value }), opts);
      }
      else if (typ === "object" && typeof value.uri === "string") {
        // uri specified in an object, we keep all other fields for RN "local" image use-case
        uniforms[name] = TextureObjects.withOpts(TextureObjects.URI(value), opts);
      }
      else if (typ === "object" && value.data && value.shape && value.stride) {
        // ndarray kind of texture
        uniforms[name] = TextureObjects.withOpts(TextureObjects.NDArray(value), opts);
      }
      else if(typ === "object" && (value instanceof Array ? React.isValidElement(value[0]) : React.isValidElement(value))) {
        // value is a VDOM or array of VDOM
        const childGLView = findGLViewInGLComponentChildren(value);
        if (childGLView) {
          // We have found a GL.View children, we integrate it in the tree and recursively do the same
          const childProps = childGLView.props;
          children.push({
            vdom: value,
            uniform: name,
            data: build(
              childProps.shader,
              childProps.uniforms,
              childProps.width || width,
              childProps.height || height,
              childProps.children,
              "preload" in childProps ? childProps.preload : preload)
          });
        }
        else {
          // in other cases VDOM, we will use child as a content
          contents.push({
            vdom: value,
            uniform: name,
            opts
          });
        }
      }
      else {
        // in any other case, it is an unrecognized invalid format
        delete uniforms[name];
        if (typeof console !== "undefined" && console.error) console.error("invalid uniform '"+name+"' value:", value); // eslint-disable-line no-console
        invariant(false, "Shader #%s: Unrecognized format for uniform '%s'", shader, name);
      }
    });

    return {
      shader,
      uniforms,
      width,
      height,
      children,
      contents,
      preload
    };
  };
};

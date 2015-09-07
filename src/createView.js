const invariant = require("invariant");

function contentTextureObject (contentId) {
  return { type: "content", id: contentId };
}

function imageTextureObject (srcOrObj) {
  if (typeof srcOrObj === "string")
    srcOrObj = { uri: srcOrObj };
  return { type: "image", value: srcOrObj };
}

function framebufferTextureObject (fbId) {
  return { type: "framebuffer", id: fbId };
}

module.exports = function (React, Shaders, Uniform, GLComponent, renderVcontainer, renderVcontent, renderVGL) {
  const {
    Component,
    PropTypes
  } = React;

  function reactFirstChildOnly (children) {
    return React.Children.count(children) === 1 ?
      (children instanceof Array ? children[0] : children) :
      null;
  }

  // buildData traverses the children, add elements to contents array and returns a data object
  function buildData (shader, fboId, glViewUniforms, width, height, glViewChildren, contents) {
    invariant(Shaders.exists(shader), "Shader #%s does not exists", shader);

    const uniforms = { ...glViewUniforms };
    const children = [];
    const genFboId = (fboIdCounter =>
      () => ++fboIdCounter===fboId ? ++fboIdCounter : fboIdCounter // ensures a child DO NOT use the same framebuffer of its parent. (skip if same)
    )(-1);

    React.Children.forEach(glViewChildren, child => {
      invariant(child.type === Uniform, "GL.View can only contains children of type GL.Uniform. Got '%s'", child.type && child.type.displayName || child);
      const { name, children } = child.props;
      invariant(typeof name === "string" && name, "GL.Uniform must define an name String");
      invariant(!(name in glViewUniforms), "The uniform '%s' set by GL.Uniform must not be in {uniforms} props");
      invariant(!(name in uniforms), "The uniform '%s' set by GL.Uniform must not be defined in another GL.Uniform");
      uniforms[name] = children;
    });

    Object.keys(uniforms)
    .filter(key => {
      const value = uniforms[key];
      // filter out the texture types...
      return value && (typeof value === "function" || typeof value === "string" || typeof value === "object" && !(value instanceof Array));
    })
    .forEach(name => {
      const value = reactFirstChildOnly(uniforms[name]);
      if (value) {
        if (!React.isValidElement(value)) {
          uniforms[name] = imageTextureObject(value);
          return;
        }
        else {
          let childGLView;

          // Recursively unfold the children while there are GLComponent and not a GLView
          let c = value;
          do {
            if (c.type === GLView) {
              childGLView = c;
              break;
            }
            if (typeof c.type !== "function") {
              break;
            }
            const instance = new c.type();
            if (!(instance instanceof GLComponent)) {
              break;
            }
            instance.props = c.props;
            c = reactFirstChildOnly(instance.render());
            if (c.type === GLView) {
              childGLView = c;
              break;
            }
          }
          while(c);

          if (childGLView) {
            const id = genFboId();
            const childProps = childGLView.props;
            children.push(
              buildData(childProps.shader, id, childProps.uniforms, width, height, childProps.children, contents)
            );
            uniforms[name] = framebufferTextureObject(id);
            return;
          }
        }
      }

      // in other cases, we will use child as a content
      const tid = contents.length;
      uniforms[name] = contentTextureObject(tid);
      contents.push(renderVcontent(width, height, tid, value));
    });

    return {
      shader,
      fboId,
      uniforms,
      width,
      height,
      children
    };
  }

  class GLView extends Component {
    constructor (props, context) {
      super(props, context);
      this._renderId = 1;
    }
    render() {
      const renderId = this._renderId ++;
      const props = this.props;
      const { style, width, height, children, shader, uniforms } = props;
      const cleanedProps = { ...props };
      delete cleanedProps.style;
      delete cleanedProps.width;
      delete cleanedProps.height;
      delete cleanedProps.shader;
      delete cleanedProps.uniforms;
      delete cleanedProps.children;

      const contents = [];
      const data = buildData(shader, -1, uniforms, width, height, children, contents);

      return renderVcontainer(
        style,
        width,
        height,
        contents,
        renderVGL(
          cleanedProps,
          width,
          height,
          data,
          contents.length,
          renderId)
      );
    }
  }

  GLView.displayName = "GL.View";
  GLView.propTypes = {
    shader: PropTypes.number.isRequired,
    width: PropTypes.number.isRequired,
    height: PropTypes.number.isRequired,
    uniforms: PropTypes.object,
    opaque: PropTypes.bool
  };
  GLView.defaultProps = {
    opaque: true
  };

  return GLView;
};

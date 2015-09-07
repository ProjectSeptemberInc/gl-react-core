const invariant = require("invariant");

function textureFromUniform (contentId) {
  return { type: "content", id: contentId };
}

function textureFromImage (srcOrObj) {
  if (typeof srcOrObj === "string")
    srcOrObj = { uri: srcOrObj };
  return { type: "image", value: srcOrObj };
}

function textureFromFramebuffer (fbId) {
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
  function buildData (shader, uniformsOriginal, width, height, children, contents) {
    invariant(Shaders.exists(shader), "Shader #%s does not exists", shader);
    const uniforms = {};
    for (let key in uniformsOriginal) {
      let value = uniformsOriginal[key];
      // filter out the texture types...
      if (value && (typeof value === "string" || typeof value === "object" && !(value instanceof Array)))
        value = textureFromImage(value);
      uniforms[key] = value;
    }

    const data = {
      shader,
      uniforms,
      width,
      height,
      children: []
    };

    React.Children.forEach(children, child => {
      invariant(child.type === Uniform, "GL.View can only contains children of type GL.Uniform. Got '%s'", child.type && child.type.displayName || child);
      const { name, children, style } = child.props;
      invariant(typeof name === "string" && name, "GL.Uniform must define an name String.");
      invariant(!(name in data.uniforms), "The uniform '%s' set by GL.Uniform is already defined in {uniforms} props");
      const onlyChild = reactFirstChildOnly(children);
      if (onlyChild) {
        if (!React.isValidElement(onlyChild)) {
          data.uniforms[name] = textureFromImage(onlyChild);
          return;
        }
        else {
          let childGLView;

          // Recursively unfold the children while there are GLComponent and not a GLView
          let c = onlyChild;
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
            const id = data.children.length;
            const { shader, uniforms, children: children2 } = childGLView.props;
            const dataChild = buildData(shader, uniforms, width, height, children2, contents);
            data.children.push(dataChild);
            data.uniforms[name] = textureFromFramebuffer(id);
            return;
          }
        }
      }

      // in other cases, we will use child as a content
      const tid = contents.length;
      data.uniforms[name] = textureFromUniform(tid);
      contents.push(renderVcontent(style, width, height, tid, children));
    });

    return data;
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
      const data = buildData(shader, uniforms, width, height, children, contents);

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

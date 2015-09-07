const invariant = require("invariant");

function ContentTextureObject (contentId) {
  return { type: "content", id: contentId };
}

function ImageTextureObject (srcOrObj) {
  if (typeof srcOrObj === "string")
    srcOrObj = { uri: srcOrObj };
  return { type: "image", value: srcOrObj };
}

function FramebufferTextureObject (fbId) {
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

  // buildData traverses the Virtual DOM to generates a data tree
  function buildData (shader, glViewUniforms, width, height, glViewChildren) {
    invariant(Shaders.exists(shader), "Shader #%s does not exists", shader);

    const uniforms = { ...glViewUniforms };
    const children = [];
    const contents = [];

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
          uniforms[name] = ImageTextureObject(value);
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
            const childProps = childGLView.props;
            children.push({
              vdom: value,
              data: buildData(childProps.shader, childProps.uniforms, width, height, childProps.children),
              uniform: name
            });
            return;
          }
        }
      }

      // in other cases, we will use child as a content
      contents.push({
        vdom: value,
        uniform: name
      });
    });

    return {
      shader,
      uniforms,
      width,
      height,
      children,
      contents
    };
  }

  // resolveData takes the output of buildData to generate the final data tree
  // that have resolved framebuffers and shared computation of duplicate uniforms (e.g: content / GL.View)
  function resolveData (data) {

    // contents are view/canvas/image/video to be rasterized "globally"
    const contentsMeta = findContentsUniq(data);
    const contentsVDOM = contentsMeta.map(({vdom}) => vdom);
    const contents = contentsVDOM.map((vdom, i) => renderVcontent(data.width, data.height, i, vdom));

    // recursively find all contents but without duplicates by comparing VDOM reference
    function findContentsUniq (data) {
      const vdoms = [];
      const contents = [];
      function rec (data) {
        data.contents.forEach(content => {
          if (vdoms.indexOf(content.vdom) === -1) {
            vdoms.push(content.vdom);
            contents.push(content);
          }
        });
        data.children.forEach(child => {
          rec(child.data);
        });
      }
      rec(data);
      return contents;
    }

    // recursively find duplicates of children by comparing VDOM reference
    function findChildrenDuplicates (data, toIgnore) {
      const vdoms = data.children.map(({vdom}) => vdom).filter(vdom => toIgnore.indexOf(vdom)===-1);
      const occurrences = vdoms.map(() => -1); // we will count it once in exploration
      function rec (data) {
        data.children.forEach(child => {
          var i = vdoms.indexOf(child.vdom);
          if (i !== -1) occurrences[i] ++;
          rec(child.data);
        });
      }
      rec(data);
      return data.children.filter((child, i) => occurrences[i] > 0);
    }

    // Recursively "resolve" the data to assign fboId and factorize duplicate uniforms to shared uniforms.
    function rec (data, fboId, parentContext) {
      const parentContextFboIds = parentContext.map(({fboId}) => fboId);
      const parentContextVDOM = parentContext.map(({vdom}) => vdom);

      const genFboId = (fboIdCounter =>
        () => {
          fboIdCounter ++;
          while (
            fboIdCounter===fboId || // ensures a child DO NOT use the same framebuffer of its parent. (skip if same)
            parentContextFboIds.indexOf(fboIdCounter)!==-1) // ensure fbo is not already taken in parent context
            fboIdCounter ++;
          return fboIdCounter;
        }
      )(-1);

      const { uniforms: dataUniforms, children: dataChildren, contents: dataContents, ...dataRest } = data;
      const uniforms = {...dataUniforms};

      const childrenDup = findChildrenDuplicates(data, parentContextVDOM);
      const childrenContext = childrenDup.map(({vdom}) => {
        const fboId = genFboId();
        return { vdom, fboId };
      });

      const context = parentContext.concat(childrenContext);
      const contextVDOM = context.map(({vdom}) => vdom);

      const contextChildren = [];
      const children = [];
      dataChildren.forEach(child => {
        const { data: childData, uniform, vdom } = child;
        let fboId;
        let i = contextVDOM.indexOf(vdom);
        if (i===-1) {
          fboId = genFboId();
          children.push(rec(childData, fboId, context));
        }
        else {
          fboId = context[i].fboId;
          if (i >= parentContext.length) // is a new context children
            contextChildren.push(rec(childData, fboId, context));
        }
        uniforms[uniform] = FramebufferTextureObject(fboId);
      });

      dataContents.forEach(({ uniform, vdom }) => {
        const id = contentsVDOM.indexOf(vdom);
        invariant(id!==-1, "contents was discovered by findContentsMeta");
        uniforms[uniform] = ContentTextureObject(id);
      });

      return {
        ...dataRest, // eslint-disable-line no-undef
        uniforms,
        contextChildren,
        children,
        fboId
      };
    }

    return {
      data: rec(data, -1, []),
      contents: contents
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

      const {data, contents} = resolveData(buildData(shader, uniforms, width, height, children));

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

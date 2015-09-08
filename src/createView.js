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

    const shaderName = Shaders.getName(shader);

    const uniforms = { ...glViewUniforms };
    const children = [];
    const contents = [];

    React.Children.forEach(glViewChildren, child => {
      invariant(child.type === Uniform, "(Shader '%s') GL.View can only contains children of type GL.Uniform. Got '%s'", shaderName, child.type && child.type.displayName || child);
      const { name, children } = child.props;
      invariant(typeof name === "string" && name, "(Shader '%s') GL.Uniform must define an name String", shaderName);
      invariant(!(name in glViewUniforms), "(Shader '%s') The uniform '%s' set by GL.Uniform must not be in {uniforms} props", shaderName);
      invariant(!(name in uniforms), "(Shader '%s') The uniform '%s' set by GL.Uniform must not be defined in another GL.Uniform", shaderName);
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
            const w = childProps.width || width;
            const h = childProps.height || height;
            children.push({
              vdom: value,
              data: buildData(childProps.shader, childProps.uniforms, w, h, childProps.children),
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

    // recursively find shared VDOM across direct children.
    // if a VDOM is used in 2 different children, it means we can share its computation in contextChildren
    function findChildrenDuplicates (data, toIgnore) {
      // FIXME the code here is a bit complex and not so performant.
      // We should see if we can precompute some data once before
      function childVDOMs ({vdom,data}, arrVdom, arrData) {
        if (toIgnore.indexOf(vdom) === -1 && arrVdom.indexOf(vdom) === -1) {
          arrVdom.push(vdom);
          arrData.push(data);
        }
        data.children.forEach(child => childVDOMs(child, arrVdom, arrData));
      }
      let allVdom = [];
      let allData = [];
      const childrenVDOMs = data.children.map(child => {
        const arrVdom = [];
        const arrData = [];
        childVDOMs(child, arrVdom, arrData);
        allVdom = allVdom.concat(arrVdom);
        allData = allData.concat(arrData);
        return arrVdom;
      });
      return allVdom.map((vdom, allIndex) => {
        let occ = 0;
        for (let i=0; i<childrenVDOMs.length; i++) {
          if (childrenVDOMs[i].indexOf(vdom) !== -1) {
            occ ++;
            if (occ > 1) return { vdom: vdom, data: allData[allIndex] };
          }
        }
      }).filter(obj => obj);
    }

    // Recursively "resolve" the data to assign fboId and factorize duplicate uniforms to shared uniforms.
    function rec (data, fboId, parentContext, parentFbos) {
      const parentContextVDOM = parentContext.map(({vdom}) => vdom);

      const genFboId = (fboIdCounter =>
        () => {
          fboIdCounter ++;
          while (
            fboIdCounter === fboId ||
            parentFbos.indexOf(fboIdCounter)!==-1) // ensure fbo is not already taken in parents
            fboIdCounter ++;
          return fboIdCounter;
        }
      )(-1);

      const { uniforms: dataUniforms, children: dataChildren, contents: dataContents, ...dataRest } = data;
      const uniforms = {...dataUniforms};

      const shared = findChildrenDuplicates(data, parentContextVDOM);
      const childrenContext = shared.map(({vdom}) => {
        const fboId = genFboId();
        return { vdom, fboId };
      });

      const context = parentContext.concat(childrenContext);
      const contextVDOM = context.map(({vdom}) => vdom);
      const contextFbos = context.map(({fboId}) => fboId);

      const contextChildren = [];
      const children = [];

      const toRecord = dataChildren.concat(shared).map(child => {
        const { data: childData, uniform, vdom } = child;
        let i = contextVDOM.indexOf(vdom);
        let fboId, addToCollection;
        if (i===-1) {
          fboId = genFboId();
          addToCollection = children;
        }
        else {
          fboId = context[i].fboId;
          if (i >= parentContext.length) {// is a new context children
            addToCollection = contextChildren;
          }
        }
        if (uniform) uniforms[uniform] = FramebufferTextureObject(fboId);
        return { fboId, childData, addToCollection };
      });

      const childrenFbos = toRecord.map(({fboId})=>fboId);
      const allFbos = parentFbos.concat(contextFbos).concat(childrenFbos);

      const recorded = [];
      toRecord.forEach(({ fboId, childData, addToCollection }) => {
        if (recorded.indexOf(fboId) === -1) {
          recorded.push(fboId);
          if (addToCollection) addToCollection.push(rec(childData, fboId, context, allFbos));
        }
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
      data: rec(data, -1, [], []),
      contentsVDOM
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
      const { style, width, height, children, shader, uniforms, debug, ...cleanedProps } = props;

      invariant(width && height && width>0 && height>0, "width and height are required for the root GLView");

      const {data, contentsVDOM} = resolveData(buildData(shader, uniforms, width, height, children));
      const contents = contentsVDOM.map((vdom, i) => renderVcontent(data.width, data.height, i, vdom));

      if (debug) {
        console.debug("GL.View rendered with", data, contentsVDOM); // eslint-disable-line no-console
      }

      return renderVcontainer(
        style,
        width,
        height,
        contents,
        renderVGL(
          cleanedProps, // eslint-disable-line no-undef
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
    width: PropTypes.number,
    height: PropTypes.number,
    uniforms: PropTypes.object,
    opaque: PropTypes.bool
  };
  GLView.defaultProps = {
    opaque: true
  };

  return GLView;
};

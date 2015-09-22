const invariant = require("invariant");

// In the future, *TextureObject format should have a "opts" that allows to give things like: { disableLinearInterpolation: true, ... }
// we can unify this on the user side with { value, opts } format, on on this side by putting opts at the same level
// using <GL.Uniform> we can allow: <GL.Uniform name="..." disableLinearInterpolation ...>...</...>

function ContentTextureObject (id) {
  return { type: "content", id };
}

function NDArrayTextureObject (ndarray) {
  return { type: "ndarray", ndarray };
}

function URITextureObject (obj) {
  return { type: "uri", ...obj };
}

function FramebufferTextureObject (id) {
  return { type: "fbo", id };
}

function withOpts (obj, opts) {
  return { ...obj, opts };
}

function extractImages (uniforms) {
  const images = [];
  for (let u in uniforms) {
    let value = uniforms[u];
    if (value &&
      typeof value === "object" &&
      value.type === "image" &&
      value.value &&
      typeof value.value.uri === "string") {
      images.push(value.value);
    }
  }
  return images;
}

function uniqImages (arr) {
  var uris = [];
  var coll = [];
  arr.forEach(function (item) {
    if (uris.indexOf(item.uri) === -1) {
      uris.push(item.uri);
      coll.push(item);
    }
  });
  return coll;
}

function isNonSamplerUniformValue (obj) {
  let typ = typeof obj;
  if (typ==="number" || typ==="boolean") return true;
  if (obj !== null && typ === "object" && obj instanceof Array) {
    typ = typeof obj[0];
    return typ==="number" || typ==="boolean";
  }
  return false;
}

module.exports = function (React, Shaders, Uniform, GLComponent, renderVcontainer, renderVcontent, renderVGL) {
  const {
    Component,
    PropTypes
  } = React;

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



  //// buildData : traverses the Virtual DOM to generates a data tree

  function buildData (shader, glViewUniforms, width, height, glViewChildren, preload) {
    invariant(Shaders.exists(shader), "Shader #%s does not exists", shader);

    const shaderName = Shaders.getName(shader);

    const uniforms = { ...glViewUniforms };
    const children = [];
    const contents = [];

    React.Children.forEach(glViewChildren, child => {
      invariant(child.type === Uniform, "(Shader '%s') GL.View can only contains children of type GL.Uniform. Got '%s'", shaderName, child.type && child.type.displayName || child);
      const { name, children } = child.props;
      invariant(typeof name === "string" && name, "(Shader '%s') GL.Uniform must define an name String", shaderName);
      invariant(!glViewUniforms || !(name in glViewUniforms), "(Shader '%s') The uniform '%s' set by GL.Uniform must not be in {uniforms} props", shaderName);
      invariant(!(name in uniforms), "(Shader '%s') The uniform '%s' set by GL.Uniform must not be defined in another GL.Uniform", shaderName);
      uniforms[name] = children;
    });

    Object.keys(uniforms)
    .forEach(name => {
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
        uniforms[name] = withOpts(URITextureObject({ uri: value }), opts);
      }
      else if (typ === "object" && typeof value.uri === "string") {
        // uri specified in an object, we keep all other fields for RN "local" image use-case
        uniforms[name] = withOpts(URITextureObject(value), opts);
      }
      else if (typ === "object" && value.data && value.shape && value.stride) {
        // ndarray kind of texture
        uniforms[name] = withOpts(NDArrayTextureObject(value), opts);
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
            data: buildData(
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
        if (typeof console !== "undefined" && console.error)
          console.error("invalid uniform '"+name+"' value:", value);
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
  }



  ///// resolveData : takes the output of buildData to generate the final data tree
  // that have resolved framebuffers and shared computation of duplicate uniforms (e.g: content / GL.View)

  function resolveData (data) {

    let imagesToPreload = [];

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

      const { uniforms: dataUniforms, children: dataChildren, contents: dataContents, preload, ...dataRest } = data;
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

      dataContents.forEach(({ uniform, vdom, opts }) => {
        const id = contentsVDOM.indexOf(vdom);
        invariant(id!==-1, "contents was discovered by findContentsMeta");
        uniforms[uniform] = withOpts(ContentTextureObject(id), opts);
      });

      // Check images to preload
      if (preload) {
        imagesToPreload = imagesToPreload.concat(extractImages(dataUniforms));
      }

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
      contentsVDOM,
      imagesToPreload: uniqImages(imagesToPreload)
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
      const { style, width, height, children, shader, uniforms, debug, preload, opaque, ...restProps } = props;
      invariant(width && height && width>0 && height>0, "width and height are required for the root GLView");

      const {data, contentsVDOM, imagesToPreload} = resolveData(buildData(shader, uniforms, width, height, children, preload||false));
      const contents = contentsVDOM.map((vdom, i) => renderVcontent(data.width, data.height, i, vdom));

      if (debug &&
        typeof console !== "undefined" &&
        console.debug // eslint-disable-line
      ) {
        console.debug("GL.View rendered with", data, contentsVDOM); // eslint-disable-line no-console
      }

      return renderVcontainer(
        width,
        height,
        contents,
        renderVGL({
          ...restProps, // eslint-disable-line no-undef
          width,
          height,
          data,
          nbContentTextures: contents.length,
          imagesToPreload,
          renderId,
          opaque
        })
      );
    }
  }

  GLView.displayName = "GL.View";
  GLView.propTypes = {
    shader: PropTypes.number.isRequired,
    width: PropTypes.number,
    height: PropTypes.number,
    uniforms: PropTypes.object,
    opaque: PropTypes.bool,
    preload: PropTypes.bool,
    autoRedraw: PropTypes.bool,
    eventsThrough: PropTypes.bool
  };
  GLView.defaultProps = {
    opaque: true
  };

  return GLView;
};

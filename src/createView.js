const invariant = require("invariant");
const { fill, resolve, createBuild } = require("./data");

function logResult (data, contentsVDOM) {
  if (typeof console !== "undefined" &&
    console.debug // eslint-disable-line
  ) {
    console.debug("GL.View rendered with", data, contentsVDOM); // eslint-disable-line no-console
  }
}

module.exports = function (React, Shaders, Uniform, GLComponent, renderVcontainer, renderVcontent, renderVGL) {
  const {
    Component,
    PropTypes
  } = React;

  let build; // will be set after GLView class defined.

  class GLView extends Component {
    constructor (props, context) {
      super(props, context);
      this._renderId = 1;
    }
    captureFrame (callback) {
      const c = this.refs.canvas;
      invariant(c && c.captureFrame, "captureFrame() should be implemented by GLCanvas");
      invariant(typeof callback === "function", "captureFrame(cb) should have a callback function in first parameter");
      return c.captureFrame.call(c, callback);
    }
    render() {
      const renderId = this._renderId ++;
      const props = this.props;
      const { style, width, height, children, shader, uniforms, debug, preload, opaque, visibleContent, eventsThrough, ...restProps } = props;

      invariant(width && height && width>0 && height>0, "width and height are required for the root GLView");

      const {data, contentsVDOM, imagesToPreload} =
        resolve(
          fill(
            build(
              shader,
              uniforms,
              width,
              height,
              children,
              preload||false)));

      if (debug) logResult(data, contentsVDOM);

      return renderVcontainer(
        { width, height, style, visibleContent, eventsThrough },
        contentsVDOM.map((vdom, i) => renderVcontent(data.width, data.height, i, vdom, { visibleContent })),
        renderVGL({
          ...restProps, // eslint-disable-line no-undef
          width,
          height,
          data,
          nbContentTextures: contentsVDOM.length,
          imagesToPreload,
          renderId,
          opaque,
          visibleContent,
          eventsThrough
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
    eventsThrough: PropTypes.bool,
    visibleContent: PropTypes.bool
  };
  GLView.defaultProps = {
    opaque: true
  };

  build = createBuild(React, Shaders, Uniform, GLComponent, GLView);

  return GLView;
};

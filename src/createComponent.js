const invariant = require("invariant");
const glViewMethods = require("./glViewMethods");

module.exports = function (React, View) {
  function createComponent (renderGLView, staticFields) {
    invariant(typeof renderGLView === "function",
    "GL.createComponent(props => glview) must have a function in parameter");
    class GLComponent extends React.Component {
      constructor (props, context) {
        super(props, context);
        glViewMethods.forEach(this._delegateMethod, this);
      }
      _delegateMethod (methodname) {
        const self = this;
        this[methodname] = function () {
          const glViewRef = self.refs._;
          invariant(glViewRef, "glView has been rendered");
          return glViewRef[methodname].apply(glViewRef, arguments);
        };
      }
      render () {
        const glView = renderGLView(this.props);
        invariant(glView && (glView.type === View || glView.type.isGLComponent),
        "The GL.createComponent function parameter must return a GL.View or another GL Component");
        return React.cloneElement(glView, { ...glView.props, ref: "_" });
      }
    }
    GLComponent.isGLComponent = true;
    GLComponent.displayName = renderGLView.name || "";
    if (staticFields) {
      invariant(typeof staticFields === "object", "second parameter of createComponent must be an object of static fields to set in the React component. (example: propTypes, displayName)");
      for (let key in staticFields) {
        GLComponent[key] = staticFields[key];
      }
    }
    return GLComponent;
  }
  return createComponent;
};

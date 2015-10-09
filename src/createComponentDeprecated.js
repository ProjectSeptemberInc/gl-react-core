const invariant = require("invariant");
const glViewMethods = require("./glViewMethods");
module.exports = function (React) {
  class GLComponent extends React.Component {
    constructor (props, context) {
      super(props, context);
      glViewMethods.forEach(methodname => {
        if (!this[methodname]) this[methodname] = () => invariant(true, "'%s' method is not available in deprecated GL.Component. Use GL.createComponent(props => glView) instead");
      });
      if (process.env.NODE_ENV !== "production")
        console.error("GL.Component class is deprecated. Use GL.createComponent(props => glView) function instead"); // eslint-disable-line no-console
    }
  }
  GLComponent.isGLComponent = true;
  return GLComponent;
};

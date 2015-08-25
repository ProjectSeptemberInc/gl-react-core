const invariant = require("invariant");

module.exports = function (React) {
  const { Component, PropTypes } = React;

  class Target extends Component {
    render () {
      invariant(
        false,
        "GL.Target elements are for GL.View configuration only and should not be rendered"
      );
    }
  }
  Target.displayName = "GL.Target";
  Target.propTypes = {
    children: PropTypes.any.isRequired,
    uniform: PropTypes.string.isRequired
  };

  return Target;
};

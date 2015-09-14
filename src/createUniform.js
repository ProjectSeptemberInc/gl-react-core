const invariant = require("invariant");

module.exports = function (React) {
  const { Component, PropTypes } = React;

  class Uniform extends Component {
    render () {
      invariant(
        false,
        "GL.Uniform elements are for GL.View configuration only and should not be rendered"
      );
    }
  }
  Uniform.displayName = "GL.Uniform";
  Uniform.propTypes = {
    children: PropTypes.any.isRequired,
    name: PropTypes.string.isRequired
  };

  return Uniform;
};

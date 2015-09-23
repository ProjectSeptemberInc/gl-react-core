
function fillWithVDOMDescendants (dataTree) {
  function rec (node) {
    let descendantsVDOM = [], descendantsVDOMData = [];
    const newChildren = node.data.children.map(node => {
      const res = rec(node);
      if (descendantsVDOM.indexOf(res.vdom) === -1) {
        descendantsVDOM.push(res.vdom);
        descendantsVDOMData.push(res.data);
      }
      res.descendantsVDOM.forEach((vdom, i) => {
        if (descendantsVDOM.indexOf(vdom) === -1) {
          descendantsVDOM.push(vdom);
          descendantsVDOMData.push(res.descendantsVDOMData[i]);
        }
      });
      return res;
    });
    return {
      ...node,
      data: { ...node.data, children: newChildren },
      descendantsVDOM,
      descendantsVDOMData
    };
  }
  return rec({ data: dataTree }).data;
}

module.exports = fillWithVDOMDescendants;

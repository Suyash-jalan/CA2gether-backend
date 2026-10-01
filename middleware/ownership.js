/**
 * Generic ownership check factory.
 * Returns middleware that verifies the authenticated user owns
 * the resource identified by `req.params.id` in the given Mongoose model.
 *
 * @param {import('mongoose').Model} Model – Mongoose model to look up
 * @param {string} ownerField – field name holding the owner's ObjectId (default: 'author')
 */
const checkOwnership = (Model, ownerField = 'author') => {
  return async (req, res, next) => {
    try {
      const doc = await Model.findById(req.params.id);

      if (!doc) {
        return res.status(404).json({ success: false, message: 'Resource not found' });
      }

      const ownerId = doc[ownerField]?.toString();

      // Allow if the user is the owner OR is an admin
      if (ownerId !== req.user._id.toString() && req.user.role !== 'admin') {
        return res
          .status(403)
          .json({ success: false, message: 'Not authorised to modify this resource' });
      }

      // Attach the doc so the controller doesn't have to re-query
      req.resource = doc;
      next();
    } catch (error) {
      next(error);
    }
  };
};

module.exports = { checkOwnership };

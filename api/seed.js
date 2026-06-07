const { connectDB, Product } = require('../_db');

module.exports = async (req, res) => {
  // Security check
  const secret = req.query.secret;
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await connectDB();

    // Products data
    const products = req.body.products;
    if (!products || !products.length) {
      return res.status(400).json({ error: 'No products provided' });
    }

    // Clear existing and insert new
    await Product.deleteMany({});

    const formatted = products.map(p => ({
      ...p,
      productId: String(p.id),
      isActive: true,
    }));

    const result = await Product.insertMany(formatted);

    return res.status(200).json({
      ok: true,
      message: `${result.length} products imported!`
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
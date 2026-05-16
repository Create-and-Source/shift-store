import { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingBag, Menu, X, ArrowRight, Minus, Plus, ChevronRight } from 'lucide-react';
import { products, collections } from './data/products';

const CartContext = createContext();

function CartProvider({ children }) {
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);

  const addToCart = (product, color, size) => {
    const key = `${product.id}-${color}-${size}`;
    setCart(prev => {
      const existing = prev.find(i => i.key === key);
      if (existing) return prev.map(i => i.key === key ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { key, product, color, size, qty: 1 }];
    });
    setCartOpen(true);
  };

  const updateQty = (key, delta) => {
    setCart(prev => prev.map(i => i.key === key ? { ...i, qty: Math.max(0, i.qty + delta) } : i).filter(i => i.qty > 0));
  };

  const cartCount = cart.reduce((sum, i) => sum + i.qty, 0);
  const cartTotal = cart.reduce((sum, i) => sum + i.product.price * i.qty, 0);

  return (
    <CartContext.Provider value={{ cart, cartOpen, setCartOpen, addToCart, updateQty, cartCount, cartTotal }}>
      {children}
    </CartContext.Provider>
  );
}

function useCart() { return useContext(CartContext); }

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function Ticker() {
  const items = [
    'Free Shipping Over $150', 'Heavyweight Premium Cotton', 'Life Keeps Moving',
    'Oversized Fit', 'Limited Drops', 'Your Mindset Your Focus Your Perspective',
  ];

  return (
    <div className="ticker">
      <div className="ticker-track">
        {[...Array(3)].map((_, rep) =>
          items.map((item, i) => (
            <span className="ticker-text" key={`${rep}-${i}`}>
              {item}
              <span className="ticker-dot" />
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { setCartOpen, cartCount } = useCart();
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => { setMobileOpen(false); }, [location]);

  return (
    <>
      <header className={`header ${scrolled ? 'scrolled' : ''}`}>
        <div className="header-inner">
          <Link to="/" className="header-logo">
            <img src="/shift-logo.jpeg" alt="Shift" className="header-logo-img" />
          </Link>
          <nav className="header-nav">
            <Link to="/shop">Shop</Link>
            <Link to="/collections">Collections</Link>
            <Link to="/about">About</Link>
          </nav>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <button className="header-cart" onClick={() => setCartOpen(true)}>
              <ShoppingBag size={20} />
              {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
            </button>
            <button className="mobile-toggle" onClick={() => setMobileOpen(true)}>
              <Menu size={24} />
            </button>
          </div>
        </div>
      </header>

      <div className={`mobile-nav ${mobileOpen ? 'open' : ''}`}>
        <button className="mobile-nav-close" onClick={() => setMobileOpen(false)}>
          <X size={28} />
        </button>
        <Link to="/" onClick={() => setMobileOpen(false)}>Home</Link>
        <Link to="/shop" onClick={() => setMobileOpen(false)}>Shop</Link>
        <Link to="/collections" onClick={() => setMobileOpen(false)}>Collections</Link>
        <Link to="/about" onClick={() => setMobileOpen(false)}>About</Link>
      </div>
    </>
  );
}

function CartDrawer() {
  const { cart, cartOpen, setCartOpen, updateQty, cartTotal } = useCart();

  return (
    <>
      <div className={`cart-overlay ${cartOpen ? 'open' : ''}`} onClick={() => setCartOpen(false)} />
      <div className={`cart-drawer ${cartOpen ? 'open' : ''}`}>
        <div className="cart-header">
          <span className="cart-title">Cart ({cart.length})</span>
          <button onClick={() => setCartOpen(false)}><X size={20} /></button>
        </div>

        {cart.length === 0 ? (
          <div className="cart-empty">
            <ShoppingBag size={32} style={{ marginBottom: 16, opacity: 0.3 }} />
            <p>Your cart is empty</p>
          </div>
        ) : (
          <>
            <div className="cart-items">
              {cart.map(item => (
                <div key={item.key} className="cart-item">
                  <img className="cart-item-img" src={item.product.image} alt={item.product.name} style={{ width: 72, height: 90, objectFit: 'cover' }} />
                  <div className="cart-item-info">
                    <div className="cart-item-name">{item.product.name}</div>
                    <div className="cart-item-variant">{item.color} / {item.size}</div>
                    <div className="cart-item-price">${item.product.price}</div>
                    <div className="cart-qty">
                      <button onClick={() => updateQty(item.key, -1)}><Minus size={12} /></button>
                      <span>{item.qty}</span>
                      <button onClick={() => updateQty(item.key, 1)}><Plus size={12} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="cart-footer" style={{ padding: '20px 24px', borderTop: '1px solid var(--gray-200)' }}>
              <div className="cart-total">
                <span>Total</span>
                <span>${cartTotal}</span>
              </div>
              <button className="checkout-btn">Checkout <ArrowRight size={14} /></button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          <img src="/shift-logo.jpeg" alt="Shift" className="footer-logo-img" />
          <p className="footer-desc">
            Your Mindset. Your Focus. Your Perspective. Life keeps moving — and so do we.
          </p>
        </div>
        <div className="footer-col">
          <h4>Shop</h4>
          <Link to="/shop">All Products</Link>
          <Link to="/shop">Tees</Link>
          <Link to="/shop">Hoodies</Link>
          <Link to="/shop">Crewnecks</Link>
          <Link to="/shop">Headwear</Link>
        </div>
        <div className="footer-col">
          <h4>Company</h4>
          <Link to="/about">About</Link>
          <Link to="/collections">Collections</Link>
          <a href="#">Size Guide</a>
          <a href="#">Contact</a>
        </div>
        <div className="footer-col">
          <h4>Info</h4>
          <a href="#">Shipping</a>
          <a href="#">Returns</a>
          <a href="#">Privacy Policy</a>
          <a href="#">Terms</a>
        </div>
      </div>
      <div className="footer-bottom">
        <span>&copy; {new Date().getFullYear()} Shift. All rights reserved.</span>
        <span>Life Keeps Moving</span>
      </div>
    </footer>
  );
}

/* ═══ PRODUCT CARD ═══ */

function ProductCard({ product, index }) {
  const navigate = useNavigate();
  return (
    <motion.div
      className="product-card"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.06 }}
      onClick={() => navigate(`/product/${product.id}`)}
    >
      <img
        className="product-card-img"
        src={product.image}
        alt={product.name}
        loading="lazy"
      />
      {product.badge && (
        <div className="product-card-badge">{product.badge}</div>
      )}
      <div className="product-card-name">{product.name}</div>
      <div className="product-card-price">
        {product.comparePrice && (
          <span style={{ textDecoration: 'line-through', color: 'var(--text-faint)', marginRight: 8 }}>${product.comparePrice}</span>
        )}
        ${product.price}
      </div>
    </motion.div>
  );
}

/* ═══ PAGES ═══ */

function HomePage() {
  const featured = products.filter(p => p.featured);
  const [heroLoaded, setHeroLoaded] = useState(false);

  return (
    <>
      {/* HERO — full-bleed video, bottom-aligned content */}
      <section className="hero">
        <div className="hero-img">
          <img src="/lifestyle/street-crossing.png" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <video
            src="/videos/shift-hero.mp4"
            autoPlay
            muted
            loop
            playsInline
            onLoadedData={() => setHeroLoaded(true)}
            style={{ position: 'absolute', inset: 0, opacity: heroLoaded ? 1 : 0, width: '100%', height: '100%', objectFit: 'cover', transition: 'opacity 1s' }}
          />
          <div className="hero-gradient" />
        </div>
        <motion.div
          className="hero-inner"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.3 }}
        >
          <div style={{ background: '#000', display: 'inline-block', lineHeight: 0 }}>
            <img src="/shift-logo.jpeg" alt="Shift" className="hero-logo-img" />
          </div>
          <div className="hero-sub">Life Keeps Moving</div>
          <Link to="/shop" className="hero-cta">
            Shop the Collection <ArrowRight size={14} />
          </Link>
        </motion.div>
      </section>

      {/* TICKER */}
      <Ticker />

      {/* EDITORIAL INTRO */}
      <motion.section
        className="intro"
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
      >
        <div className="intro-label">The Brand</div>
        <h2 className="intro-headline">
          More than apparel. A mindset. A movement. A daily reminder to keep pushing forward.
        </h2>
        <p className="intro-body">
          Every piece we create carries the energy of forward motion. Heavyweight, premium, built to last — designed for people who move with intention, not distraction. The arrow only points one direction.
        </p>
      </motion.section>

      {/* SPREAD — Image Left, Text Right */}
      <section className="spread">
        <div className="spread-img">
          <img src="/lifestyle/street-crossing.png" alt="Shift on the streets" loading="lazy" />
        </div>
        <motion.div
          className="spread-text"
          initial={{ opacity: 0, x: 40 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
        >
          <div className="spread-label">Essentials</div>
          <h2 className="spread-title">Built for<br />the Move</h2>
          <p className="spread-body">
            400gsm heavyweight cotton. Oversized, relaxed cuts. Pre-shrunk fleece that holds its shape wear after wear. This isn't fast fashion — it's built to last.
          </p>
          <Link to="/shop" className="spread-link">
            Shop Essentials <ArrowRight size={14} />
          </Link>
        </motion.div>
      </section>

      {/* PULLQUOTE */}
      <motion.section
        className="pullquote"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
      >
        <p className="pullquote-text">
          "The arrow only points one direction — <em>forward</em>. There is no reverse, no pause button, no going back."
        </p>
      </motion.section>

      {/* PRODUCT GRID */}
      <section className="products-section">
        <div className="products-header">
          <h2 className="products-title">The Collection</h2>
          <Link to="/shop" className="products-link">
            View All <ArrowRight size={14} />
          </Link>
        </div>
        <div className="products-grid">
          {featured.map((p, i) => (
            <ProductCard key={p.id} product={p} index={i} />
          ))}
        </div>
      </section>

      {/* PHOTO GRID */}
      <div className="photo-grid">
        <div className="photo-grid-item tall">
          <img src="/lifestyle/chinatown.jpg" alt="Shift Chinatown" loading="lazy" />
        </div>
        <div className="photo-grid-item">
          <img src="/lifestyle/nyc-convertible.png" alt="Shift NYC" loading="lazy" />
        </div>
        <div className="photo-grid-item">
          <img src="/lifestyle/car-meet.png" alt="Shift car meet" loading="lazy" />
        </div>
        <div className="photo-grid-item">
          <img src="/lifestyle/coffee-shop.png" alt="Shift coffee" loading="lazy" />
        </div>
        <div className="photo-grid-item tall">
          <img src="/lifestyle/nyc-crosswalk.png" alt="Shift crosswalk" loading="lazy" />
        </div>
        <div className="photo-grid-item">
          <img src="/lifestyle/pool-party.png" alt="Shift poolside" loading="lazy" />
        </div>
      </div>

      {/* DARK SECTION — Reverse Spread */}
      <section className="dark-section">
        <div className="spread spread-reverse" style={{ minHeight: 'auto' }}>
          <motion.div
            className="spread-text"
            initial={{ opacity: 0, x: -40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            <div className="spread-label">Limited Edition</div>
            <h2 className="spread-title">Racing<br />Collection</h2>
            <p className="spread-body">
              Vintage acid wash. All-over racing graphics. "Built for Speed. No Limits." — a capsule for those who live in the fast lane.
            </p>
            <Link to="/product/shift-racing-tee" className="spread-link">
              Shop Racing <ArrowRight size={14} />
            </Link>
          </motion.div>
          <div className="spread-img">
            <img src="/lifestyle/nyc-convertible-red.png" alt="Racing collection" loading="lazy" />
          </div>
        </div>
      </section>

      {/* SECOND SPREAD — New Arrivals */}
      <section className="spread">
        <div className="spread-img">
          <img src="/lifestyle/convertible-pink-red.png" alt="Pink collection" loading="lazy" />
        </div>
        <motion.div
          className="spread-text"
          initial={{ opacity: 0, x: 40 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
        >
          <div className="spread-label">New Colorways</div>
          <h2 className="spread-title">Pink &<br />Olive Drops</h2>
          <p className="spread-body">
            Fresh colorways, same heavyweight quality. The Pink Collection and Olive & Orange bring new energy to the Shift lineup.
          </p>
          <Link to="/shop" className="spread-link">
            Shop New Arrivals <ArrowRight size={14} />
          </Link>
        </motion.div>
      </section>

      {/* NEWSLETTER */}
      <section className="newsletter">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
        >
          <div className="newsletter-label">Stay in the Loop</div>
          <h3 className="newsletter-title">Join the Movement</h3>
          <p className="newsletter-sub">Early access to drops, exclusive colorways, and first dibs on limited editions.</p>
          <form className="newsletter-form" onSubmit={e => e.preventDefault()}>
            <input type="email" placeholder="Your email" />
            <button type="submit">Subscribe</button>
          </form>
        </motion.div>
      </section>
    </>
  );
}

function ShopPage() {
  const [activeFilter, setActiveFilter] = useState('all');
  const filtered = collections.find(c => c.id === activeFilter)?.filter
    ? products.filter(collections.find(c => c.id === activeFilter).filter)
    : products;

  return (
    <>
      <div className="shop-header">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <h1 className="shop-title">Shop All</h1>
          <div className="shop-filters">
            {collections.map(c => (
              <button
                key={c.id}
                className={`filter-btn ${activeFilter === c.id ? 'active' : ''}`}
                onClick={() => setActiveFilter(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </motion.div>
      </div>

      <div className="shop-grid">
        {filtered.map((p, i) => (
          <ProductCard key={p.id} product={p} index={i} />
        ))}
      </div>
    </>
  );
}

function ProductPage() {
  const { id } = useParams();
  const product = products.find(p => p.id === id);
  const [selectedColor, setSelectedColor] = useState(0);
  const [selectedSize, setSelectedSize] = useState(null);
  const { addToCart } = useCart();

  if (!product) return <div style={{ padding: '200px 40px', textAlign: 'center', color: 'var(--text-light)' }}>Product not found</div>;

  const handleAdd = () => {
    if (!selectedSize) return;
    addToCart(product, product.colors[selectedColor].name, selectedSize);
  };

  return (
    <div className="pdp">
      <div className="pdp-layout">
        <div>
          <img
            className="pdp-gallery-img"
            src={product.image}
            alt={product.name}
          />
        </div>

        <motion.div
          className="pdp-info"
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="pdp-breadcrumb">
            <Link to="/shop">Shop</Link> <ChevronRight size={10} style={{ margin: '0 6px' }} /> {product.category}
          </div>

          {product.badge && (
            <div className="product-card-badge" style={{ marginBottom: 16 }}>{product.badge}</div>
          )}

          <h1 className="pdp-name">{product.name}</h1>
          <div className="pdp-price">
            {product.comparePrice && (
              <span style={{ textDecoration: 'line-through', color: 'var(--text-faint)', marginRight: 12 }}>${product.comparePrice}</span>
            )}
            ${product.price}
          </div>
          <p className="pdp-desc">{product.description}</p>

          {product.colors.length > 1 && (
            <>
              <div className="pdp-label">Color — {product.colors[selectedColor].name}</div>
              <div className="color-options">
                {product.colors.map((c, i) => (
                  <button
                    key={c.name}
                    className={`color-swatch ${selectedColor === i ? 'active' : ''}`}
                    style={{ background: c.hex }}
                    onClick={() => setSelectedColor(i)}
                  />
                ))}
              </div>
            </>
          )}

          <div className="pdp-label">Size</div>
          <div className="size-options">
            {product.sizes.map(s => (
              <button
                key={s}
                className={`size-btn ${selectedSize === s ? 'active' : ''}`}
                onClick={() => setSelectedSize(s)}
              >
                {s}
              </button>
            ))}
          </div>

          <button className="add-btn" onClick={handleAdd} style={{ opacity: selectedSize ? 1 : 0.5 }}>
            {selectedSize ? 'Add to Cart' : 'Select a Size'} <ArrowRight size={14} />
          </button>
        </motion.div>
      </div>
    </div>
  );
}

function CollectionsPage() {
  return (
    <>
      <div className="shop-header">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <h1 className="shop-title">Collections</h1>
          <p style={{ fontSize: 15, color: 'var(--text-light)', marginTop: 12 }}>Curated drops. Each one tells a story.</p>
        </motion.div>
      </div>

      <div className="collections-grid">
        <Link to="/shop" className="collection-card">
          <img src="/lifestyle/pizza-shop.png" alt="Essentials" loading="lazy" />
          <div className="collection-card-overlay">
            <div className="collection-card-label">Core</div>
            <div className="collection-card-title">Essentials</div>
          </div>
        </Link>
        <Link to="/shop" className="collection-card">
          <img src="/lifestyle/car-meet.png" alt="Racing" loading="lazy" />
          <div className="collection-card-overlay">
            <div className="collection-card-label">Limited</div>
            <div className="collection-card-title">Racing</div>
          </div>
        </Link>
        <Link to="/shop" className="collection-card">
          <img src="/lifestyle/convertible-pink-red.png" alt="New arrivals" loading="lazy" />
          <div className="collection-card-overlay">
            <div className="collection-card-label">New</div>
            <div className="collection-card-title">Fresh Drops</div>
          </div>
        </Link>
        <Link to="/shop" className="collection-card">
          <img src="/lifestyle/subway.png" alt="City series" loading="lazy" />
          <div className="collection-card-overlay">
            <div className="collection-card-label">Vintage</div>
            <div className="collection-card-title">City Series</div>
          </div>
        </Link>
      </div>

      <section className="newsletter" style={{ marginTop: 40 }}>
        <div className="newsletter-label">Be First</div>
        <h3 className="newsletter-title">Get Notified</h3>
        <p className="newsletter-sub">Be the first to know when new collections drop.</p>
        <form className="newsletter-form" onSubmit={e => e.preventDefault()}>
          <input type="email" placeholder="Your email" />
          <button type="submit">Notify Me</button>
        </form>
      </section>
    </>
  );
}

function AboutPage() {
  return (
    <>
      <div className="shop-header" style={{ paddingBottom: 0 }}>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 16 }}>The Story</div>
          <h1 className="shop-title">Life Keeps Moving</h1>
        </motion.div>
      </div>

      <motion.section
        className="intro"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        style={{ paddingTop: 60 }}
      >
        <p className="intro-body">
          Shift was born from a simple truth: life doesn't wait. The arrow in our logo only points one direction — forward. There is no reverse, no pause button, no going back.
        </p>
        <p className="intro-body" style={{ marginTop: 24 }}>
          We make clothes for people who move. Not just physically, but mentally. People who are shifting their mindset, sharpening their focus, and changing their perspective on what's possible.
        </p>
        <p className="intro-body" style={{ marginTop: 24 }}>
          Every piece we create carries that energy. Heavyweight, premium, built to last — because the journey doesn't end after one wear. Our designs are rooted in movement: roads, speed, direction, purpose.
        </p>
      </motion.section>

      <div className="pullquote">
        <p className="pullquote-text">
          "This isn't just streetwear. It's a daily reminder. Shift your mindset. Shift your focus. Shift your perspective. <em>And keep moving forward.</em>"
        </p>
      </div>

      <section className="spread">
        <div className="spread-img">
          <img src="/lifestyle/convertible-pink-red.png" alt="Shift lifestyle" loading="lazy" />
        </div>
        <div className="spread-text" style={{ alignItems: 'center', textAlign: 'center' }}>
          <img src="/shift-logo.jpeg" alt="Shift" style={{ width: 200, marginBottom: 24 }} />
          <p style={{ fontSize: 15, color: 'var(--text-light)', lineHeight: 1.8 }}>Your Mindset. Your Focus. Your Perspective.</p>
        </div>
      </section>

      <div className="photo-grid">
        <div className="photo-grid-item">
          <img src="/lifestyle/nyc-crosswalk.png" alt="NYC" loading="lazy" />
        </div>
        <div className="photo-grid-item">
          <img src="/lifestyle/pool-party.png" alt="Pool party" loading="lazy" />
        </div>
        <div className="photo-grid-item">
          <img src="/lifestyle/street-crossing.png" alt="Street" loading="lazy" />
        </div>
      </div>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <CartProvider>
        <ScrollToTop />
        <Header />
        <CartDrawer />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/shop" element={<ShopPage />} />
          <Route path="/product/:id" element={<ProductPage />} />
          <Route path="/collections" element={<CollectionsPage />} />
          <Route path="/about" element={<AboutPage />} />
        </Routes>
        <Footer />
      </CartProvider>
    </BrowserRouter>
  );
}

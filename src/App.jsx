import { useState, useEffect, useRef, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShoppingBag, Menu, X, ArrowRight, ArrowLeft, Minus, Plus, ChevronRight, ChevronLeft, CheckCircle, Loader, Package, Truck, Eye, LogOut, Lock, Mail, Clock, Search } from 'lucide-react';
import { supabase } from './lib/supabase';

/* ═══ PRODUCTS CONTEXT — fetches from Fulfill Engine ═══ */
const ProductsContext = createContext();

function ProductsProvider({ children }) {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/products')
      .then(r => r.json())
      .then(data => {
        setProducts(data.products || []);
        setCategories(data.categories || []);
      })
      .catch(err => console.error('Failed to load products:', err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ProductsContext.Provider value={{ products, categories, loading }}>
      {children}
    </ProductsContext.Provider>
  );
}

function useProducts() { return useContext(ProductsContext); }

const CartContext = createContext();

function CartProvider({ children }) {
  const [cart, setCart] = useState(() => {
    try { return JSON.parse(localStorage.getItem('shift-cart')) || []; } catch { return []; }
  });
  const [cartOpen, setCartOpen] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);

  useEffect(() => {
    localStorage.setItem('shift-cart', JSON.stringify(cart));
  }, [cart]);

  const addToCart = (product, color, size, image, sizeSurcharge = 0) => {
    const key = `${product.id}-${color}-${size}`;
    const price = product.price + sizeSurcharge;
    setCart(prev => {
      const existing = prev.find(i => i.key === key);
      if (existing) return prev.map(i => i.key === key ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { key, product, color, size, image, price, qty: 1 }];
    });
    setCartOpen(true);
  };

  const updateQty = (key, delta) => {
    setCart(prev => prev.map(i => i.key === key ? { ...i, qty: Math.max(0, i.qty + delta) } : i).filter(i => i.qty > 0));
  };

  const clearCart = () => { setCart([]); localStorage.removeItem('shift-cart'); };

  const cartCount = cart.reduce((sum, i) => sum + i.qty, 0);
  const cartTotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);

  const checkout = async () => {
    if (cart.length === 0 || checkingOut) return;
    setCheckingOut(true);
    try {
      const res = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map(i => ({
            productId: i.product.id,
            name: i.product.name,
            price: i.price,
            qty: i.qty,
            color: i.color,
            size: i.size,
            image: i.image,
          })),
          shipping: 10,
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error('Checkout error:', data.error);
        setCheckingOut(false);
      }
    } catch (err) {
      console.error('Checkout error:', err);
      setCheckingOut(false);
    }
  };

  return (
    <CartContext.Provider value={{ cart, cartOpen, setCartOpen, addToCart, updateQty, clearCart, cartCount, cartTotal, checkout, checkingOut }}>
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

function GlitchText({ children, tag: Tag = 'span', className = '' }) {
  return (
    <Tag className={`glitch ${className}`} data-text={children}>
      {children}
    </Tag>
  );
}

function Ticker() {
  const items = [
    'Life Keeps Moving', 'Oversized Fit', 'Limited Drops', 'Forward Only',
    'No Reverse', 'Shift Your Perspective',
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

function Marquee({ children }) {
  return (
    <div className="marquee">
      <div className="marquee-track">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="marquee-item">{children}</div>
        ))}
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
            <img src="/shift-logo.png" alt="Shift" className="header-logo-img" />
          </Link>
          <nav className="header-nav">
            <Link to="/shop">Shop</Link>
            <Link to="/collections">Collections</Link>
            <Link to="/about">About</Link>
            <Link to="/account">Account</Link>
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
        <Link to="/account" onClick={() => setMobileOpen(false)}>Account</Link>
      </div>
    </>
  );
}

function CartDrawer() {
  const { cart, cartOpen, setCartOpen, updateQty, cartTotal } = useCart();
  const navigate = useNavigate();

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
                  <img className="cart-item-img" src={item.image || item.product.image} alt={item.product.name} />
                  <div className="cart-item-info">
                    <div className="cart-item-name">{item.product.name}</div>
                    <div className="cart-item-variant">{item.color} / {item.size}</div>
                    <div className="cart-item-price">${item.price.toFixed(2)}</div>
                    <div className="cart-qty">
                      <button onClick={() => updateQty(item.key, -1)}><Minus size={12} /></button>
                      <span>{item.qty}</span>
                      <button onClick={() => updateQty(item.key, 1)}><Plus size={12} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="cart-footer">
              <div className="cart-total">
                <span>Subtotal</span>
                <span>${cartTotal.toFixed(2)}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 12 }}>Shipping calculated at checkout</div>
              <button className="checkout-btn" onClick={() => { setCartOpen(false); navigate('/checkout'); }}>
                Checkout <ArrowRight size={14} />
              </button>
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
          <img src="/shift-logo.png" alt="Shift" className="footer-logo-img" />
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
        </div>
        <div className="footer-col">
          <h4>Info</h4>
          <a href="#">Shipping</a>
          <a href="#">Returns</a>
          <a href="#">Privacy</a>
          <a href="#">Terms</a>
        </div>
      </div>
      <div className="footer-bottom">
        <span>&copy; {new Date().getFullYear()} Shift. All rights reserved.</span>
        <span style={{ color: 'var(--red)' }}>Life Keeps Moving &rarr;</span>
      </div>
    </footer>
  );
}

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
      <div className="glitch-img-wrap">
        <img
          className="product-card-img"
          src={product.image}
          alt={product.name}
          loading="lazy"
        />
      </div>
      {product.badge && <div className="product-card-badge">{product.badge}</div>}
      <div className="product-card-name">{product.name}</div>
      <div className="product-card-price">
        {product.comparePrice && (
          <span style={{ textDecoration: 'line-through', color: 'var(--gray)', marginRight: 8 }}>${product.comparePrice}</span>
        )}
        ${product.price}
      </div>
    </motion.div>
  );
}

function ProductCarousel({ products: items }) {
  const trackRef = useRef(null);
  const [current, setCurrent] = useState(0);
  const navigate = useNavigate();

  const scroll = (dir) => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector('.carousel-slide');
    if (!card) return;
    const w = card.offsetWidth + 16;
    const next = Math.max(0, Math.min(current + dir, items.length - 1));
    track.scrollTo({ left: w * next, behavior: 'smooth' });
    setCurrent(next);
  };

  const onScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector('.carousel-slide');
    if (!card) return;
    const w = card.offsetWidth + 16;
    const idx = Math.round(track.scrollLeft / w);
    setCurrent(idx);
  };

  return (
    <div className="carousel">
      <div className="carousel-viewfinder">
        <div className="vf-corner vf-tl" />
        <div className="vf-corner vf-tr" />
        <div className="vf-corner vf-bl" />
        <div className="vf-corner vf-br" />
        <div className="carousel-counter">
          <span className="carousel-counter-current">{String(current + 1).padStart(2, '0')}</span>
          <span className="carousel-counter-sep">/</span>
          <span className="carousel-counter-total">{String(items.length).padStart(2, '0')}</span>
        </div>
      </div>

      <div className="carousel-track" ref={trackRef} onScroll={onScroll}>
        {items.map((p, i) => (
          <div
            key={p.id}
            className={`carousel-slide ${i === current ? 'active' : ''}`}
            onClick={() => navigate(`/product/${p.id}`)}
          >
            <div className="carousel-slide-img glitch-img-wrap">
              <img src={p.image} alt={p.name} />
              {p.badge && <div className="carousel-badge">{p.badge}</div>}
            </div>
            <div className="carousel-slide-info">
              <div className="carousel-slide-name">{p.name}</div>
              <div className="carousel-slide-price">${p.price}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="carousel-nav">
        <button className="carousel-btn" onClick={() => scroll(-1)} disabled={current === 0}>
          <ArrowLeft size={18} />
        </button>
        <div className="carousel-dots">
          {items.map((_, i) => (
            <div key={i} className={`carousel-dot ${i === current ? 'active' : ''}`} />
          ))}
        </div>
        <button className="carousel-btn" onClick={() => scroll(1)} disabled={current === items.length - 1}>
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}

/* ═══ PAGES ═══ */

function HomePage() {
  const { products } = useProducts();
  const featured = products.slice(0, 6);
  const [heroLoaded, setHeroLoaded] = useState(false);

  return (
    <>
      {/* SCANLINES */}
      <div className="scanlines" />

      {/* HERO */}
      <section className="hero">
        <div className="hero-media">
          <img src="/lifestyle/street-crossing.png" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <video
            src="/videos/shift-hero.mp4"
            autoPlay muted loop playsInline
            onLoadedData={() => setHeroLoaded(true)}
            style={{ position: 'absolute', inset: 0, opacity: heroLoaded ? 1 : 0, width: '100%', height: '100%', objectFit: 'cover', transition: 'opacity 1s' }}
          />
          <div className="hero-gradient" />
          <div className="hero-scanline" />
        </div>
        <motion.div
          className="hero-inner"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.3 }}
        >
          <img src="/shift-logo.png" alt="Shift" className="hero-logo-img" />
          <div className="hero-tagline">Life Keeps Moving</div>
          <Link to="/shop" className="hero-cta">
            Shop Now <ArrowRight size={14} />
          </Link>
        </motion.div>
      </section>

      {/* TICKER */}
      <Ticker />

      {/* GLITCH MARQUEE */}
      <Marquee>
        <span className="filled">SHIFT</span> <span>&rarr;</span> <span className="red">FORWARD</span> <span>&rarr;</span> <span>ONLY</span> <span>&rarr;</span>
      </Marquee>

      {/* INTRO */}
      <motion.section
        className="intro"
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
      >
        <div className="intro-label">The Brand</div>
        <h2 className="intro-headline">
          <GlitchText>More than apparel. A mindset.</GlitchText>
        </h2>
        <p className="intro-body">
          Every piece carries the energy of forward motion. Heavyweight, premium, built to last — designed for people who move with intention. The arrow only points one direction.
        </p>
      </motion.section>

      {/* SPREAD — Essentials */}
      <section className="spread">
        <div className="spread-img glitch-img-wrap">
          <img src="/lifestyle/street-crossing.png" alt="Shift on the streets" loading="lazy" />
        </div>
        <motion.div
          className="spread-text"
          initial={{ opacity: 0, x: 40 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
        >
          <h2 className="spread-title"><GlitchText>Meet the Creator</GlitchText></h2>
          <p className="spread-body">
            The heart of this brand is the belief that life's unexpected turns are opportunities to shift, adapt, and move forward. SHIFT was inspired by my own challenges—from weight loss to facing fears—knowing growth comes from change. We're here to encourage you to pivot with purpose, embrace new paths, and ALWAYS keep moving forward.
          </p>
          <Link to="/about" className="spread-link">
            View the Mission <ArrowRight size={14} />
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
          "The arrow only points one direction — <em>forward</em>."
        </p>
      </motion.section>

      {/* PRODUCTS — Camera Roll Carousel */}
      <section className="products-section">
        <div className="products-header">
          <h2 className="products-title">The Collection</h2>
          <Link to="/shop" className="products-link">
            View All <ArrowRight size={14} />
          </Link>
        </div>
        <ProductCarousel products={featured} />
      </section>

      {/* MARQUEE 2 */}
      <Marquee>
        <span className="red">NO REVERSE</span> <span>&rarr;</span> <span className="filled">KEEP MOVING</span> <span>&rarr;</span> <span>SHIFT</span> <span>&rarr;</span>
      </Marquee>

      {/* PHOTO GRID */}
      <div className="photo-grid">
        <div className="photo-grid-item tall glitch-img-wrap">
          <img src="/lifestyle/chinatown.jpg" alt="Shift Chinatown" loading="lazy" />
        </div>
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/nyc-convertible.png" alt="Shift NYC" loading="lazy" />
        </div>
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/car-meet.png" alt="Shift car meet" loading="lazy" />
        </div>
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/coffee-shop.png" alt="Shift coffee" loading="lazy" />
        </div>
        <div className="photo-grid-item tall glitch-img-wrap">
          <img src="/lifestyle/nyc-crosswalk.png" alt="Shift crosswalk" loading="lazy" />
        </div>
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/pool-party.png" alt="Shift poolside" loading="lazy" />
        </div>
      </div>

      {/* DARK SECTION — Racing */}
      <section className="dark-section">
        <div className="spread spread-reverse" style={{ minHeight: 'auto' }}>
          <motion.div
            className="spread-text"
            style={{ background: 'var(--bg-raised)' }}
            initial={{ opacity: 0, x: -40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            <div className="spread-label">Our Staples</div>
            <h2 className="spread-title"><GlitchText>The "OG" Collection</GlitchText></h2>
            <p className="spread-body">
              Vintage acid wash. Cool Graphics. Built for those who know that life keeps moving — and so should we.
            </p>
            <Link to="/shop" className="spread-link">
              Shop Staples <ArrowRight size={14} />
            </Link>
          </motion.div>
          <div className="spread-img glitch-img-wrap">
            <video src="/videos/shift-racing.mp4" autoPlay muted loop playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        </div>
      </section>


      {/* NEWSLETTER */}
      <section className="newsletter">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
        >
          <div className="newsletter-label">Stay Locked In</div>
          <h3 className="newsletter-title"><GlitchText>Join the Movement</GlitchText></h3>
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
  const { products, categories, loading } = useProducts();
  const [activeFilter, setActiveFilter] = useState('all');

  const filters = [
    { id: 'all', name: 'All' },
    ...categories.map(c => ({ id: c.id || c.name, name: c.name })),
  ];

  const filtered = activeFilter === 'all'
    ? products
    : products.filter(p => p.category === activeFilter);

  return (
    <>
      <div className="scanlines" />
      <div className="shop-header">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <h1 className="shop-title"><GlitchText>Shop All</GlitchText></h1>
          {filters.length > 1 && (
            <div className="shop-filters">
              {filters.map(c => (
                <button
                  key={c.id}
                  className={`filter-btn ${activeFilter === c.id ? 'active' : ''}`}
                  onClick={() => setActiveFilter(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </motion.div>
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '100px 0', color: 'var(--gray)' }}>
          <Loader size={24} className="spin" />
          <p style={{ marginTop: 16 }}>Loading products...</p>
        </div>
      ) : (
        <div className="shop-grid">
          {filtered.map((p, i) => (
            <ProductCard key={p.id} product={p} index={i} />
          ))}
        </div>
      )}
    </>
  );
}

function ProductPage() {
  const { id } = useParams();
  const { products, loading } = useProducts();
  const product = products.find(p => p.id === id);
  const [selectedColor, setSelectedColor] = useState(0);
  const [selectedSize, setSelectedSize] = useState(null);
  const { addToCart } = useCart();

  if (loading) return <div style={{ padding: '200px 40px', textAlign: 'center', color: 'var(--gray)' }}><Loader size={24} className="spin" /></div>;
  if (!product) return <div style={{ padding: '200px 40px', textAlign: 'center', color: 'var(--gray)' }}>Product not found</div>;

  const currentColor = product.colors[selectedColor] || product.colors[0];
  const currentImages = currentColor?.images || [];
  const mainImage = currentImages[0]?.url || product.image;
  const selectedSizeObj = product.sizes.find(s => s.name === selectedSize);
  const totalPrice = product.price + (selectedSizeObj?.surcharge || 0);

  const handleAdd = () => {
    if (!selectedSize) return;
    addToCart(product, currentColor.name, selectedSize, mainImage, selectedSizeObj?.surcharge || 0);
  };

  return (
    <div className="pdp">
      <div className="scanlines" />
      <div className="pdp-layout">
        <div className="pdp-gallery">
          {currentImages.map((img, i) => (
            <div key={i} className="glitch-img-wrap">
              <img className="pdp-gallery-img" src={img.url} alt={`${product.name} ${img.type}`} />
            </div>
          ))}
          {currentImages.length === 0 && (
            <div className="glitch-img-wrap">
              <img className="pdp-gallery-img" src={product.image} alt={product.name} />
            </div>
          )}
        </div>

        <motion.div
          className="pdp-info"
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="pdp-breadcrumb">
            <Link to="/shop">Shop</Link> <ChevronRight size={10} style={{ margin: '0 6px' }} /> {product.name}
          </div>

          <h1 className="pdp-name">{product.name}</h1>
          <div className="pdp-price">${totalPrice.toFixed(2)}</div>
          <p className="pdp-desc">{product.description}</p>

          {product.colors.length > 1 && (
            <>
              <div className="pdp-label">Color — {currentColor.name}</div>
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

          {product.sizes.length > 0 && (
            <>
              <div className="pdp-label">Size</div>
              <div className="size-options">
                {product.sizes.map(s => (
                  <button
                    key={s.name}
                    className={`size-btn ${selectedSize === s.name ? 'active' : ''}`}
                    onClick={() => setSelectedSize(s.name)}
                  >
                    {s.name}{s.surcharge > 0 ? ` (+$${s.surcharge.toFixed(2)})` : ''}
                  </button>
                ))}
              </div>
            </>
          )}

          <button className="add-btn" onClick={handleAdd} style={{ opacity: (selectedSize || product.sizes.length === 0) ? 1 : 0.5 }}>
            {(selectedSize || product.sizes.length === 0) ? 'Add to Cart' : 'Select a Size'} <ArrowRight size={14} />
          </button>
        </motion.div>
      </div>
    </div>
  );
}

function CollectionsPage() {
  const boards = [
    { img: '/lifestyle/pizza-shop.png', label: 'Core', title: 'Essentials', rot: -3 },
    { img: '/lifestyle/car-meet.png', label: 'Limited', title: 'Racing', rot: 2.5 },
    { img: '/lifestyle/convertible-pink-red.png', label: 'New', title: 'Fresh Drops', rot: -1.5 },
    { img: '/lifestyle/subway.png', label: 'Vintage', title: 'City Series', rot: 4 },
    { img: '/lifestyle/chinatown.jpg', label: 'Street', title: 'Chinatown', rot: -2 },
    { img: '/lifestyle/nyc-crosswalk.png', label: 'Lifestyle', title: 'NYC', rot: 3 },
  ];

  return (
    <>
      <div className="scanlines" />
      <div className="shop-header">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <h1 className="shop-title"><GlitchText>Collections</GlitchText></h1>
          <p style={{ fontSize: 15, color: 'var(--gray)', marginTop: 12 }}>Curated drops. Each one tells a story.</p>
        </motion.div>
      </div>

      <div className="board">
        <div className="board-inner">
          {boards.map((b, i) => (
            <Link
              to="/shop"
              key={i}
              className="pin-card"
              style={{
                '--rot': `${b.rot}deg`,
                '--delay': `${i * 0.4}s`,
              }}
            >
              <div className="pin" />
              <div className="pin-shadow" />
              <div className="pin-photo">
                <img src={b.img} alt={b.title} loading="lazy" />
              </div>
              <div className="pin-label">
                <span className="pin-label-tag">{b.label}</span>
                <span className="pin-label-title">{b.title}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <section className="newsletter" style={{ marginTop: 40 }}>
        <div className="newsletter-label">Be First</div>
        <h3 className="newsletter-title"><GlitchText>Get Notified</GlitchText></h3>
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
      <div className="scanlines" />
      <div className="shop-header" style={{ paddingBottom: 0 }}>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--red)', marginBottom: 16 }}>The Story</div>
          <h1 className="shop-title"><GlitchText>Life Keeps Moving</GlitchText></h1>
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
        <div className="spread-img glitch-img-wrap">
          <img src="/lifestyle/convertible-pink-red.png" alt="Shift lifestyle" loading="lazy" />
        </div>
        <div className="spread-text" style={{ alignItems: 'center', textAlign: 'center' }}>
          <img src="/shift-logo.png" alt="Shift" style={{ width: 200, filter: 'brightness(0) invert(1)', marginBottom: 24 }} />
          <p style={{ fontSize: 15, color: 'var(--gray)', lineHeight: 1.8 }}>Your Mindset. Your Focus. Your Perspective.</p>
        </div>
      </section>

      <div className="photo-grid">
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/nyc-crosswalk.png" alt="NYC" loading="lazy" />
        </div>
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/pool-party.png" alt="Pool party" loading="lazy" />
        </div>
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/street-crossing.png" alt="Street" loading="lazy" />
        </div>
      </div>
    </>
  );
}

function CheckoutPage() {
  const { cart, updateQty, cartTotal, checkout, checkingOut } = useCart();
  const { products } = useProducts();
  const navigate = useNavigate();
  const [selectedSuggestion, setSelectedSuggestion] = useState(null);

  const cartProductIds = new Set(cart.map(i => i.product.id));
  const suggestions = products.filter(p => !cartProductIds.has(p.id)).slice(0, 6);

  if (!cart.length) {
    return (
      <>
        <div className="scanlines" />
        <div className="ck-page">
          <div className="ck-empty">
            <ShoppingBag size={40} style={{ opacity: 0.3, marginBottom: 16 }} />
            <h2>Your cart is empty</h2>
            <Link to="/shop" className="hero-cta" style={{ display: 'inline-flex', marginTop: 16 }}>Continue Shopping <ArrowRight size={14} /></Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="scanlines" />
      <div className="ck-page">
        <div className="ck-container">
          <div className="ck-left">
            <Link to="/shop" className="ck-back"><ArrowLeft size={14} /> Continue Shopping</Link>
            <h1 className="ck-title"><GlitchText>Checkout</GlitchText></h1>
            <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 32 }}>{cart.length} item{cart.length !== 1 ? 's' : ''} in your bag</p>

            <div className="ck-items">
              {cart.map(item => (
                <div key={item.key} className="ck-item">
                  <img src={item.image || item.product.image} alt={item.product.name} className="ck-item-img" />
                  <div className="ck-item-info">
                    <div className="ck-item-name">{item.product.name}</div>
                    <div className="ck-item-variant">{item.color} / {item.size}</div>
                    <div className="ck-item-price">${item.price.toFixed(2)}</div>
                    <div className="ck-item-actions">
                      <div className="cart-qty">
                        <button onClick={() => updateQty(item.key, -1)}><Minus size={12} /></button>
                        <span>{item.qty}</span>
                        <button onClick={() => updateQty(item.key, 1)}><Plus size={12} /></button>
                      </div>
                      <button className="ck-remove" onClick={() => updateQty(item.key, -item.qty)}>Remove</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="ck-right">
            <div className="ck-summary">
              <h2 style={{ fontSize: 16, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 20 }}>Order Summary</h2>
              <div className="ck-summary-row">
                <span>Subtotal</span>
                <span>${cartTotal.toFixed(2)}</span>
              </div>
              <div className="ck-summary-row">
                <span>Shipping</span>
                <span style={{ fontSize: 12, color: 'var(--gray)' }}>Calculated at payment</span>
              </div>
              <div className="ck-summary-row ck-summary-total">
                <span>Estimated Total</span>
                <span>${cartTotal.toFixed(2)}</span>
              </div>
              <button className="ck-pay-btn" onClick={checkout} disabled={checkingOut}>
                {checkingOut ? <><Loader size={14} className="spin" /> Processing...</> : <>Pay Now <ArrowRight size={14} /></>}
              </button>
              <p className="ck-secure">
                <Lock size={12} /> Secure checkout. Your payment info is encrypted.
              </p>
            </div>
          </div>
        </div>

        {suggestions.length > 0 && (
          <div className="ck-suggestions">
            <h3 style={{ fontSize: 16, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Add to Your Order</h3>
            <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 24 }}>Same flat rate shipping no matter how many items you add.</p>
            <div className="ck-suggestions-grid">
              {suggestions.map(p => (
                <div key={p.id} className="ck-suggestion" onClick={() => navigate(`/product/${p.id}`)}>
                  <img src={p.image} alt={p.name} />
                  <div className="ck-suggestion-name">{p.name}</div>
                  <div className="ck-suggestion-price">${p.price.toFixed(2)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function OrderSuccessPage() {
  const { clearCart } = useCart();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');

  useEffect(() => {
    if (sessionId) clearCart();
  }, [sessionId]);

  return (
    <>
      <div className="scanlines" />
      <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '120px 24px 80px', textAlign: 'center' }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6 }}
        >
          <CheckCircle size={48} style={{ color: 'var(--red)', marginBottom: 24 }} />
          <h1 style={{ fontSize: 'clamp(28px, 5vw, 42px)', fontWeight: 900, textTransform: 'uppercase', marginBottom: 16 }}>
            <GlitchText>Order Confirmed</GlitchText>
          </h1>
          <p style={{ fontSize: 16, color: 'var(--gray)', maxWidth: 480, margin: '0 auto 32px', lineHeight: 1.6 }}>
            Thanks for your order. You'll receive a confirmation email shortly with tracking info once your items ship.
          </p>
          <Link to="/shop" className="hero-cta" style={{ display: 'inline-flex' }}>
            Continue Shopping <ArrowRight size={14} />
          </Link>
        </motion.div>
      </div>
    </>
  );
}

/* ═══ ADMIN DASHBOARD ═══ */

const ADMIN_KEY = 'shift-admin-2026';

function AdminPage() {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem('shift-admin') === 'true');
  const [password, setPassword] = useState('');

  if (!authed) {
    return (
      <div className="admin-login">
        <div className="admin-login-card">
          <Lock size={32} style={{ color: 'var(--red)', marginBottom: 16 }} />
          <h2>Admin Access</h2>
          <form onSubmit={e => {
            e.preventDefault();
            if (password === ADMIN_KEY) {
              sessionStorage.setItem('shift-admin', 'true');
              setAuthed(true);
            }
          }}>
            <input type="password" placeholder="Admin password" value={password} onChange={e => setPassword(e.target.value)} />
            <button type="submit">Enter</button>
          </form>
        </div>
      </div>
    );
  }

  return <AdminDashboard />;
}

function AdminDashboard() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const navigate = useNavigate();

  const fetchOrders = async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/orders?status=${filter}`, {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    const data = await res.json();
    setOrders(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => { fetchOrders(); }, [filter]);

  const updateOrder = async (orderId, updates) => {
    await fetch('/api/admin/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
      body: JSON.stringify({ orderId, ...updates }),
    });
    fetchOrders();
    if (selected?.id === orderId) {
      setSelected(prev => ({ ...prev, ...updates }));
    }
  };

  const statuses = ['all', 'new', 'processing', 'shipped', 'delivered', 'cancelled'];
  const statusColors = { new: '#e53e3e', processing: '#dd6b20', shipped: '#3182ce', delivered: '#38a169', cancelled: '#718096' };

  const logout = () => {
    sessionStorage.removeItem('shift-admin');
    navigate('/');
  };

  return (
    <div className="admin">
      <div className="admin-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/shift-logo.png" alt="Shift" style={{ height: 28, filter: 'brightness(0) invert(1)' }} />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gray)' }}>Admin</span>
        </div>
        <button onClick={logout} style={{ background: 'none', border: 'none', color: 'var(--gray)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          <LogOut size={16} /> Logout
        </button>
      </div>

      <div className="admin-stats">
        {['new', 'processing', 'shipped', 'delivered'].map(s => {
          const count = orders.filter(o => filter === 'all' ? o.status === s : true).length;
          return filter === 'all' ? (
            <div key={s} className="admin-stat" onClick={() => setFilter(s)} style={{ cursor: 'pointer' }}>
              <div className="admin-stat-count" style={{ color: statusColors[s] }}>{orders.filter(o => o.status === s).length}</div>
              <div className="admin-stat-label">{s}</div>
            </div>
          ) : null;
        })}
        {filter === 'all' && (
          <div className="admin-stat">
            <div className="admin-stat-count">{orders.length}</div>
            <div className="admin-stat-label">total</div>
          </div>
        )}
      </div>

      <div className="admin-filters">
        {statuses.map(s => (
          <button key={s} className={`filter-btn ${filter === s ? 'active' : ''}`} onClick={() => { setFilter(s); setSelected(null); }}>
            {s === 'all' ? 'All Orders' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <div className="admin-content">
        <div className="admin-orders-list">
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray)' }}><Loader size={20} className="spin" /></div>
          ) : orders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray)' }}>No orders</div>
          ) : (
            orders.map(order => (
              <div
                key={order.id}
                className={`admin-order-row ${selected?.id === order.id ? 'selected' : ''}`}
                onClick={() => setSelected(order)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>#{order.id.slice(0, 8)}</span>
                  <span className="status-badge" style={{ background: statusColors[order.status] + '22', color: statusColors[order.status] }}>
                    {order.status}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--gray)' }}>
                  {order.customer?.name || order.customer?.email || 'Guest'}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12 }}>
                  <span style={{ color: 'var(--gray)' }}>{new Date(order.created_at).toLocaleDateString()}</span>
                  <span style={{ fontWeight: 600 }}>${Number(order.total).toFixed(2)}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {selected && <AdminOrderDetail order={selected} onUpdate={updateOrder} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}

function AdminOrderDetail({ order, onUpdate, onClose }) {
  const [tracking, setTracking] = useState(order.tracking_number || '');
  const [trackingUrl, setTrackingUrl] = useState(order.tracking_url || '');
  const [notes, setNotes] = useState(order.admin_notes || '');

  useEffect(() => {
    setTracking(order.tracking_number || '');
    setTrackingUrl(order.tracking_url || '');
    setNotes(order.admin_notes || '');
  }, [order.id]);

  const addr = order.shipping_address || {};
  const statusColors = { new: '#e53e3e', processing: '#dd6b20', shipped: '#3182ce', delivered: '#38a169', cancelled: '#718096' };
  const nextStatus = { new: 'processing', processing: 'shipped', shipped: 'delivered' };

  return (
    <div className="admin-order-detail">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Order #{order.id.slice(0, 8)}</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--gray)', cursor: 'pointer' }}><X size={18} /></button>
      </div>

      <div className="admin-detail-section">
        <div className="admin-detail-label">Status</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className="status-badge" style={{ background: statusColors[order.status] + '22', color: statusColors[order.status], fontSize: 13 }}>
            {order.status}
          </span>
          {nextStatus[order.status] && (
            <button className="admin-action-btn" onClick={() => onUpdate(order.id, { status: nextStatus[order.status] })}>
              Mark as {nextStatus[order.status]}
            </button>
          )}
          {order.status !== 'cancelled' && order.status !== 'delivered' && (
            <button className="admin-action-btn" style={{ color: '#e53e3e' }} onClick={() => {
              if (confirm('Cancel this order?')) onUpdate(order.id, { status: 'cancelled' });
            }}>Cancel</button>
          )}
        </div>
      </div>

      <div className="admin-detail-section">
        <div className="admin-detail-label">Customer</div>
        <div>{order.customer?.name || '—'}</div>
        <div style={{ fontSize: 13, color: 'var(--gray)' }}>{order.customer?.email}</div>
      </div>

      <div className="admin-detail-section">
        <div className="admin-detail-label">Shipping Address</div>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          {addr.name && <div>{addr.name}</div>}
          {addr.line1 && <div>{addr.line1}</div>}
          {addr.line2 && <div>{addr.line2}</div>}
          <div>{[addr.city, addr.state, addr.postal_code].filter(Boolean).join(', ')}</div>
        </div>
      </div>

      <div className="admin-detail-section">
        <div className="admin-detail-label">Items</div>
        {(order.items || []).map((item, i) => (
          <div key={i} className="admin-item-row">
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{item.product_name}</div>
              <div style={{ fontSize: 12, color: 'var(--gray)' }}>{[item.color, item.size].filter(Boolean).join(' / ')}</div>
            </div>
            <div style={{ fontSize: 13, textAlign: 'right' }}>
              <div>x{item.quantity}</div>
              <div>${Number(item.unit_price).toFixed(2)}</div>
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', fontWeight: 700 }}>
          <span>Total</span>
          <span>${Number(order.total).toFixed(2)}</span>
        </div>
      </div>

      <div className="admin-detail-section">
        <div className="admin-detail-label">Tracking</div>
        <input placeholder="Tracking number" value={tracking} onChange={e => setTracking(e.target.value)} className="admin-input" />
        <input placeholder="Tracking URL (optional)" value={trackingUrl} onChange={e => setTrackingUrl(e.target.value)} className="admin-input" style={{ marginTop: 8 }} />
        <button className="admin-action-btn" style={{ marginTop: 8 }} onClick={() => onUpdate(order.id, { tracking_number: tracking, tracking_url: trackingUrl })}>
          Save Tracking
        </button>
      </div>

      <div className="admin-detail-section">
        <div className="admin-detail-label">Notes</div>
        <textarea placeholder="Internal notes..." value={notes} onChange={e => setNotes(e.target.value)} className="admin-input" rows={3} />
        <button className="admin-action-btn" style={{ marginTop: 8 }} onClick={() => onUpdate(order.id, { admin_notes: notes })}>
          Save Notes
        </button>
      </div>

      <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 16 }}>
        Created: {new Date(order.created_at).toLocaleString()}<br />
        Updated: {new Date(order.updated_at).toLocaleString()}
      </div>
    </div>
  );
}

/* ═══ CUSTOMER PORTAL ═══ */

function AccountPage() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleAuth = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (authMode === 'magic') {
      const { error } = await supabase.auth.signInWithOtp({ email });
      if (error) setError(error.message);
      else setMessage('Check your email for a login link!');
      return;
    }

    if (authMode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
      return;
    }

    if (authMode === 'signup') {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else setMessage('Account created! Check your email to confirm.');
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  if (loading) return <div style={{ padding: '200px 0', textAlign: 'center' }}><Loader size={24} className="spin" /></div>;

  if (!user) {
    return (
      <>
        <div className="scanlines" />
        <div className="portal-auth">
          <div className="portal-auth-card">
            <img src="/shift-logo.png" alt="Shift" style={{ height: 36, filter: 'brightness(0) invert(1)', marginBottom: 24 }} />
            <h2 style={{ fontSize: 20, fontWeight: 800, textTransform: 'uppercase', marginBottom: 8 }}>My Account</h2>
            <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 24 }}>Track your orders and manage your account</p>

            <div className="portal-auth-tabs">
              <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>Sign In</button>
              <button className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')}>Sign Up</button>
              <button className={authMode === 'magic' ? 'active' : ''} onClick={() => setAuthMode('magic')}>Magic Link</button>
            </div>

            <form onSubmit={handleAuth}>
              <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required className="portal-input" />
              {authMode !== 'magic' && (
                <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required className="portal-input" />
              )}
              <button type="submit" className="portal-btn">
                {authMode === 'magic' ? 'Send Magic Link' : authMode === 'signup' ? 'Create Account' : 'Sign In'}
              </button>
            </form>

            {error && <div style={{ color: '#e53e3e', fontSize: 13, marginTop: 12 }}>{error}</div>}
            {message && <div style={{ color: '#38a169', fontSize: 13, marginTop: 12 }}>{message}</div>}
          </div>
        </div>
      </>
    );
  }

  return <CustomerDashboard user={user} onLogout={handleLogout} />;
}

function CustomerDashboard({ user, onLogout }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    async function load() {
      // Get customer's orders via the anon key (RLS filters to their orders)
      const { data } = await supabase
        .from('orders')
        .select('*, items:order_items(*)')
        .order('created_at', { ascending: false });
      setOrders(data || []);
      setLoading(false);
    }
    load();
  }, []);

  const statusSteps = ['new', 'processing', 'shipped', 'delivered'];
  const statusLabels = { new: 'Order Placed', processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered' };
  const statusIcons = { new: Package, processing: Clock, shipped: Truck, delivered: CheckCircle };

  return (
    <>
      <div className="scanlines" />
      <div className="portal">
        <div className="portal-header">
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, textTransform: 'uppercase', marginBottom: 4 }}>My Orders</h1>
            <p style={{ fontSize: 13, color: 'var(--gray)' }}>{user.email}</p>
          </div>
          <button onClick={onLogout} className="portal-logout">
            <LogOut size={14} /> Sign Out
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}><Loader size={24} className="spin" /></div>
        ) : orders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--gray)' }}>
            <Package size={32} style={{ marginBottom: 16, opacity: 0.3 }} />
            <p>No orders yet</p>
            <Link to="/shop" className="hero-cta" style={{ display: 'inline-flex', marginTop: 16 }}>Start Shopping <ArrowRight size={14} /></Link>
          </div>
        ) : (
          <div className="portal-orders">
            {orders.map(order => (
              <div key={order.id} className="portal-order-card" onClick={() => setSelected(selected?.id === order.id ? null : order)}>
                <div className="portal-order-top">
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>Order #{order.id.slice(0, 8)}</div>
                    <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2 }}>{new Date(order.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700 }}>${Number(order.total).toFixed(2)}</div>
                    <div style={{ fontSize: 11, color: order.status === 'delivered' ? '#38a169' : 'var(--red)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{order.status}</div>
                  </div>
                </div>

                {/* Status timeline */}
                <div className="portal-timeline">
                  {statusSteps.map((step, i) => {
                    const currentIdx = statusSteps.indexOf(order.status === 'cancelled' ? 'new' : order.status);
                    const active = i <= currentIdx;
                    const Icon = statusIcons[step];
                    return (
                      <div key={step} className={`portal-timeline-step ${active ? 'active' : ''}`}>
                        <div className="portal-timeline-dot"><Icon size={12} /></div>
                        <span>{statusLabels[step]}</span>
                        {i < statusSteps.length - 1 && <div className={`portal-timeline-line ${i < currentIdx ? 'active' : ''}`} />}
                      </div>
                    );
                  })}
                </div>

                {order.status === 'cancelled' && (
                  <div style={{ fontSize: 13, color: '#e53e3e', fontWeight: 600, marginTop: 8 }}>This order was cancelled</div>
                )}

                {selected?.id === order.id && (
                  <div className="portal-order-detail">
                    <div className="portal-detail-label">Items</div>
                    {(order.items || []).map((item, i) => (
                      <div key={i} className="portal-item-row">
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{item.product_name}</div>
                          <div style={{ fontSize: 12, color: 'var(--gray)' }}>{[item.color, item.size].filter(Boolean).join(' / ')} x{item.quantity}</div>
                        </div>
                        <div style={{ fontWeight: 600 }}>${(Number(item.unit_price) * item.quantity).toFixed(2)}</div>
                      </div>
                    ))}

                    {order.tracking_number && (
                      <div style={{ marginTop: 16 }}>
                        <div className="portal-detail-label">Tracking</div>
                        {order.tracking_url ? (
                          <a href={order.tracking_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--red)', fontSize: 13 }}>
                            {order.tracking_number} <ArrowRight size={12} />
                          </a>
                        ) : (
                          <span style={{ fontSize: 13 }}>{order.tracking_number}</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export default function App() {
  const location = window.location.pathname;
  const isAdmin = location.startsWith('/dashadmin');

  // Admin routes don't need the store layout
  if (isAdmin) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/dashadmin" element={<AdminPage />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <ProductsProvider>
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
            <Route path="/checkout" element={<CheckoutPage />} />
            <Route path="/order-success" element={<OrderSuccessPage />} />
            <Route path="/account" element={<AccountPage />} />
          </Routes>
          <Footer />
        </CartProvider>
      </ProductsProvider>
    </BrowserRouter>
  );
}

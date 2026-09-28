/* CampusLink – board logic
   Listings you post are stored in this browser only (localStorage).
   To share listings between users, replace the storage calls with a real backend. */

// ---------- Data ----------

var CATEGORIES = [
  "Tutoring",
  "Design & Tech",
  "Writing & Typing",
  "Beauty & Fashion",
  "Food & Delivery",
  "Repairs",
  "Errands"
];

// ---------- State ----------
var SEED = [
  {
    type: "offer",
    cat: "Tutoring",
    title: "Calculus and physics tutoring",
    desc: "Weekly small-group sessions with worked past questions. Weekday evenings.",
    name: "Ada O.",
    uni: "Engineering, 400L",
    price: "2,500 per hour",
    contact: "ada.tutor@example.com"
  },
  {
    type: "request",
    cat: "Design & Tech",
    title: "Poster and flyer for society week",
    desc: "Need two A3 posters and a social media flyer by Friday. Brand colours provided.",
    name: "Tobi A.",
    uni: "Mass Comm, 200L",
    price: "Budget 8,000",
    contact: "08000000001"
  },
  {
    type: "offer",
    cat: "Repairs",
    title: "Phone screen and battery fixes",
    desc: "Same-day repairs for common phones. Hostel pickup available on request.",
    name: "Emeka N.",
    uni: "Electrical Eng, 300L",
    price: "From 4,000",
    contact: "emeka.fix@example.com"
  },
  {
    type: "offer",
    cat: "Beauty & Fashion",
    title: "Braiding and hair styling",
    desc: "Book a slot at the female hostel common room. Bring your own extensions or I can source.",
    name: "Zainab K.",
    uni: "Nursing, 200L",
    price: "From 5,000",
    contact: "08000000002"
  },
  {
    type: "request",
    cat: "Writing & Typing",
    title: "Someone to type and format my project",
    desc: "60 pages handwritten, need typing, referencing and a clean PDF.",
    name: "Chidi E.",
    uni: "Economics, 400L",
    price: "Negotiable",
    contact: "chidi.e@example.com"
  },
  {
    type: "offer",
    cat: "Food & Delivery",
    title: "Meal prep and hostel delivery",
    desc: "Jollof, stew and snacks. Order before 11am for a 1pm delivery to any hostel.",
    name: "Ife B.",
    uni: "Food Science, 300L",
    price: "From 1,800 per plate",
    contact: "08000000003"
  },
  {
    type: "request",
    cat: "Errands",
    title: "Pick up printed materials from town",
    desc: "Need someone going off campus on Saturday to collect a parcel.",
    name: "Sam D.",
    uni: "Law, 100L",
    price: "1,500",
    contact: "sam.d@example.com"
  },
  {
    type: "offer",
    cat: "Design & Tech",
    title: "Website and slide deck help",
    desc: "Portfolio sites, final year defence slides and CVs. Fast turnaround.",
    name: "Kelvin M.",
    uni: "Computer Science, 400L",
    price: "From 6,000",
    contact: "kelvin.dev@example.com"
  }
];

// Current filters chosen by the visitor
var filters = { type: "all", cat: "All", q: "" };

// Listings posted by the visitor (loaded from this browser's storage)
var posts = [];
try {
  posts = JSON.parse(localStorage.getItem("cl_posts") || "[]");
} catch (e) {
  posts = [];
}

// ---------- Helpers ----------

function $(selector) {
  return document.querySelector(selector);
}

// Turns text into safe HTML so user input can't inject markup
function escapeHtml(text) {
  var div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Shows a short message at the bottom of the screen
function showToast(message) {
  var toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("on");
  setTimeout(function () {
    toast.classList.remove("on");
  }, 2400);
}

// ---------- Contact links ----------

// Country code (no "+") added to numbers that start with 0, e.g. 0803... becomes 234803...
// 234 = Nigeria. Change this to your country's code if needed.
var DEFAULT_COUNTRY_CODE = "234";

var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmail(value) {
  return EMAIL_PATTERN.test(value.trim());
}

// Turns whatever the person typed into digits only, in international format
// (no +, no spaces). Returns "" if it doesn't look like a phone number.
function toInternationalNumber(value) {
  var text = value.trim();
  var digits = text.replace(/\D/g, "");

  if (text.charAt(0) === "+") {
    // Already has a country code, e.g. +234 803 000 0000
  } else if (digits.indexOf("00") === 0) {
    // 00234... style
    digits = digits.slice(2);
  } else if (digits.charAt(0) === "0") {
    // Local style, e.g. 0803... so swap the leading 0 for the country code
    digits = DEFAULT_COUNTRY_CODE + digits.slice(1);
  }

  return digits.length >= 8 && digits.length <= 15 ? digits : "";
}

function isValidContact(value) {
  return isEmail(value) || toInternationalNumber(value) !== "";
}

// Builds the buttons that open WhatsApp, a phone call, or an email draft
function renderContactActions(post) {
  var firstName = post.name.split(" ")[0];
  var contact = post.contact.trim();

  var intro = post.type === "offer"
    ? "Hi " + firstName + ", I saw your listing \"" + post.title + "\" on CampusLink and I'm interested."
    : "Hi " + firstName + ", I saw your request \"" + post.title + "\" on CampusLink and I can help.";

  // Email address: open an email draft addressed to that person
  if (isEmail(contact)) {
    var mailto =
      "mailto:" + contact +
      "?subject=" + encodeURIComponent("CampusLink: " + post.title) +
      "&body=" + encodeURIComponent(intro);

    return '<a class="btn" href="' + escapeHtml(mailto) + '">Email ' + escapeHtml(firstName) + "</a>";
  }

  // Phone number: WhatsApp chat or a normal phone call
  var number = toInternationalNumber(contact);

  if (number) {
    var whatsapp = "https://wa.me/" + number + "?text=" + encodeURIComponent(intro);

    return (
      '<a class="btn wa" href="' + escapeHtml(whatsapp) + '" target="_blank" rel="noopener">WhatsApp</a>' +
      '<a class="btn" href="tel:+' + number + '">Call</a>'
    );
  }

  // Anything else (older or unusual entries): just show the text
  return '<span class="contact-text">' + escapeHtml(contact) + "</span>";
}

// ---------- Rendering ----------

function renderChips() {
  var html = ["All"].concat(CATEGORIES).map(function (category) {
    return (
      '<button class="chip" data-cat="' + escapeHtml(category) + '" ' +
      'aria-pressed="' + (filters.cat === category) + '">' +
      escapeHtml(category) +
      "</button>"
    );
  }).join("");

  $("#chips").innerHTML = html;
}

function renderCard(post) {
  var label = post.type === "offer" ? "Offering" : "Looking for";

  return (
    '<article class="card ' + post.type + '">' +
      '<span class="tag">' + label + " · " + escapeHtml(post.cat) + "</span>" +
      "<h3>" + escapeHtml(post.title) + "</h3>" +
      "<p>" + escapeHtml(post.desc) + "</p>" +
      '<div class="meta">' +
        "<span>" + escapeHtml(post.name) + ", " + escapeHtml(post.uni) + "</span>" +
        "<b>" + escapeHtml(post.price) + "</b>" +
      "</div>" +
      '<div class="actions">' + renderContactActions(post) + "</div>" +
    "</article>"
  );
}

function renderBoard() {
  var query = filters.q.toLowerCase();
  var allPosts = posts.concat(SEED); // your posts appear first

  var visible = allPosts.filter(function (post) {
    var matchesType = filters.type === "all" || post.type === filters.type;
    var matchesCategory = filters.cat === "All" || post.cat === filters.cat;
    var searchable = (post.title + " " + post.desc + " " + post.cat + " " + post.name).toLowerCase();
    var matchesSearch = !query || searchable.indexOf(query) > -1;

    return matchesType && matchesCategory && matchesSearch;
  });

  if (visible.length) {
    $("#grid").innerHTML = visible.map(renderCard).join("");
  } else {
    $("#grid").innerHTML =
      '<div class="empty">Nothing matches yet. Clear the filters, or post this one yourself.</div>';
  }
}

// ---------- Events ----------

// One click handler for all buttons on the page
document.addEventListener("click", function (event) {
  var button = event.target.closest("button");
  if (!button) return;

  // "All / Offers / Requests" toggle
  if (button.dataset.type) {
    filters.type = button.dataset.type;
    document.querySelectorAll(".seg button").forEach(function (b) {
      b.setAttribute("aria-pressed", b === button);
    });
    renderBoard();

  // Category chip
  } else if (button.dataset.cat) {
    filters.cat = button.dataset.cat;
    renderChips();
    renderBoard();

  // Any "Post" / "Offer a service" / "I need something" button
  } else if (button.dataset.post) {
    var isOffer = button.dataset.post === "offer";
    $("#ft").value = button.dataset.post;
    $("#dt").textContent = isOffer ? "Offer a service" : "Request a service";
    $("#dlg").showModal();
  }
});

// Live search
$("#q").addEventListener("input", function (event) {
  filters.q = event.target.value;
  renderBoard();
});

// Close the dialog
$("#cancel").addEventListener("click", function () {
  $("#dlg").close();
});

// Publish a new listing
$("#f").addEventListener("submit", function (event) {
  event.preventDefault();

  var listing = Object.fromEntries(new FormData(event.target).entries());

  // The contact must be an email address or a phone number, so the links work
  if (!isValidContact(listing.contact)) {
    showToast("Enter a valid phone number or email address");
    return;
  }

  posts.unshift(listing);

  // Keep the 30 most recent posts in this browser
  try {
    localStorage.setItem("cl_posts", JSON.stringify(posts.slice(0, 30)));
  } catch (e) {
    // Storage may be blocked; the listing still shows for this visit
  }

  $("#dlg").close();
  event.target.reset();

  // Reset filters so the new listing is visible
  filters = { type: "all", cat: "All", q: "" };
  $("#q").value = "";
  document.querySelectorAll(".seg button").forEach(function (b) {
    b.setAttribute("aria-pressed", b.dataset.type === "all");
  });

  renderChips();
  renderBoard();
  showToast("Listing published");
  location.hash = "#board";
});

// ---------- Start ----------

// Fill the category dropdown in the post form
$("#fc").innerHTML = CATEGORIES.map(function (category) {
  return "<option>" + escapeHtml(category) + "</option>";
}).join("");

renderChips();
renderBoard();

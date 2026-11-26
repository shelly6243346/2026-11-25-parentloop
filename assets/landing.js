(function () {
  // Google Apps Script web app that appends rows to the "ParentLoop Waitlist" Google Sheet.
  var WAITLIST_URL = "__WAITLIST_URL__";
  var form = document.getElementById("waitlist-form");
  if (!form) return;

  document.querySelectorAll(".nav-links a").forEach(function (link) {
    link.addEventListener("click", function () {
      var details = document.querySelector(".nav-details");
      if (details) details.open = false;
    });
  });

  // Clear entries left by the earlier browser-only version of this form.
  try { localStorage.removeItem("parentloop.waitlist.v1"); } catch (err) {}

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var error = document.getElementById("waitlist-error");
    var success = document.getElementById("waitlist-success");
    var button = form.querySelector('button[type="submit"]');
    var name = form.name.value.trim();
    var email = form.email.value.trim();
    var role = form.role.value;
    success.textContent = "";

    if (!name) {
      error.textContent = "Add your name.";
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      error.textContent = "Add a valid email address.";
      return;
    }

    error.textContent = "";
    button.disabled = true;
    button.textContent = "Joining…";

    var body = new URLSearchParams();
    body.append("name", name);
    body.append("email", email);
    body.append("role", role);
    body.append("website", form.website ? form.website.value : "");

    fetch(WAITLIST_URL, { method: "POST", mode: "no-cors", body: body })
      .then(function () {
        success.textContent = "Thanks, you're on the list! We'll email you when the pilot opens.";
        form.reset();
      })
      .catch(function () {
        error.textContent = "Something went wrong. Check your connection and try again.";
      })
      .then(function () {
        button.disabled = false;
        button.textContent = "Join the waitlist";
      });
  });
})();

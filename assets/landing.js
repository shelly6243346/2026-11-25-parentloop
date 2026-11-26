(function () {
  var KEY = "parentloop.waitlist.v1";
  var form = document.getElementById("waitlist-form");
  if (!form) return;

  document.querySelectorAll(".nav-links a").forEach(function (link) {
    link.addEventListener("click", function () {
      var details = document.querySelector(".nav-details");
      if (details) details.open = false;
    });
  });

  function read() {
    try {
      var data = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(data) ? data : [];
    } catch (err) {
      return [];
    }
  }

  function write(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
  }

  function renderSaved() {
    var box = document.getElementById("waitlist-saved");
    if (!box) return;
    box.replaceChildren();
    var list = read();
    if (!list.length) return;

    var note = document.createElement("p");
    var strong = document.createElement("strong");
    strong.textContent = "Saved on this browser only. ";
    note.appendChild(strong);
    note.appendChild(document.createTextNode("Nothing was sent to a server."));

    var ul = document.createElement("ul");
    ul.className = "saved-list";
    list.forEach(function (item) {
      var li = document.createElement("li");
      var span = document.createElement("span");
      span.textContent = item.name + " · " + item.email + " · " + item.role;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-small btn-secondary";
      button.textContent = "Remove";
      button.setAttribute("data-remove", item.email);
      li.appendChild(span);
      li.appendChild(button);
      ul.appendChild(li);
    });
    box.appendChild(note);
    box.appendChild(ul);
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var error = document.getElementById("waitlist-error");
    var success = document.getElementById("waitlist-success");
    var name = form.name.value.trim();
    var email = form.email.value.trim();
    var role = form.role.value;
    success.textContent = "";

    if (!name) {
      error.textContent = "Add your name.";
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      error.textContent = "Add an email address. It stays on this device.";
      return;
    }

    try {
      var list = read();
      var index = -1;
      for (var i = 0; i < list.length; i++) {
        if (String(list[i].email).toLowerCase() === email.toLowerCase()) index = i;
      }
      var entry = { name: name, email: email, role: role, at: new Date().toISOString() };
      if (index >= 0) {
        list[index] = entry;
        success.textContent = "Updated the entry already saved on this browser. Nothing was sent.";
      } else {
        list.push(entry);
        success.textContent = "Saved on this browser. ParentLoop did not send this anywhere.";
      }
      write(list);
      error.textContent = "";
      form.reset();
      renderSaved();
    } catch (err) {
      error.textContent = "This browser blocked local storage, so the form cannot save here.";
    }
  });

  var saved = document.getElementById("waitlist-saved");
  if (saved) {
    saved.addEventListener("click", function (event) {
      var button = event.target.closest("[data-remove]");
      if (!button) return;
      var email = button.getAttribute("data-remove");
      try {
        write(read().filter(function (item) { return item.email !== email; }));
        renderSaved();
        document.getElementById("waitlist-success").textContent = "Removed from this browser.";
      } catch (err) {
        document.getElementById("waitlist-error").textContent = "Could not update local storage in this browser.";
      }
    });
  }

  renderSaved();
})();

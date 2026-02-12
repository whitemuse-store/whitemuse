// WhiteMuse main app logic
document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("fileInput");
  const preview = document.getElementById("preview");

  input.addEventListener("change", () => {
    preview.innerHTML = "";
    [...input.files].forEach(file => {
      const img = document.createElement("img");
      img.src = URL.createObjectURL(file);
      img.style.maxWidth = "150px";
      img.style.margin = "8px";
      preview.appendChild(img);
    });
  });
});

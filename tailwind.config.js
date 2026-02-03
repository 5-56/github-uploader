/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,js}"],
  theme: {
    extend: {
      colors: {
        github: {
          dark: '#0d1117',
          gray: '#161b22',
          border: '#30363d',
          text: '#c9d1d9',
          green: '#238636',
          blue: '#58a6ff',
        }
      }
    },
  },
  plugins: [],
}

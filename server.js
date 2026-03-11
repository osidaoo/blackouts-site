const express = require("express")
const cors = require("cors")
const { createClient } = require("@supabase/supabase-js")

const app = express()

app.use(cors())
app.use(express.json())

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

app.get("/", (req, res) => {
  res.send("API Blackouts funcionando")
})

app.get("/produtos", async (req, res) => {

  const { data, error } = await supabase
    .from("products")
    .select("*")

  if (error) {
    return res.status(500).json(error)
  }

  res.json(data)

})

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log("Servidor rodando na porta", PORT)
})

require("dotenv").config()

const express = require("express")
const cors = require("cors")
const bcrypt = require("bcrypt")
const jwt = require("jsonwebtoken")
const { createClient } = require("@supabase/supabase-js")

const app = express()

app.use(cors())
app.use(express.json())

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const PORT = process.env.PORT || 3000

// =============================
// TESTE SERVIDOR
// =============================

app.get("/", (req, res) => {
  res.json({ status: "API Blackouts online" })
})

// =============================
// LISTAR PRODUTOS
// =============================

app.get("/produtos", async (req, res) => {
  const { data, error } = await supabase
    .from("produtos")
    .select("*")

  if (error) {
    return res.status(500).json(error)
  }

  res.json(data)
})

// =============================
// LOGIN
// =============================

app.post("/login", async (req, res) => {

  const { email, senha } = req.body

  const { data, error } = await supabase
    .from("Usuários")
    .select("*")
    .eq("e-mail", email)
    .single()

  if (!data) {
    return res.status(401).json({ erro: "Usuário não encontrado" })
  }

  const senhaValida = await bcrypt.compare(
    senha,
    data.hash_da_senha
  )

  if (!senhaValida) {
    return res.status(401).json({ erro: "Senha inválida" })
  }

  const token = jwt.sign(
    {
      id: data.id,
      papel: data.papel
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  )

  res.json({
    token,
    usuario: {
      id: data.id,
      nome: data.nome,
      papel: data.papel
    }
  })
})

// =============================
// CRIAR PRODUTO (ADMIN)
// =============================

app.post("/admin/produtos", async (req, res) => {

  const { nome, preco, estoque } = req.body

  const { data, error } = await supabase
    .from("produtos")
    .insert([
      {
        nome,
        preco,
        estoque
      }
    ])
    .select()

  if (error) {
    return res.status(500).json(error)
  }

  res.json(data)
})

// =============================
// ATUALIZAR PRODUTO
// =============================

app.put("/admin/produtos/:id", async (req, res) => {

  const { id } = req.params
  const { nome, preco, estoque } = req.body

  const { data, error } = await supabase
    .from("produtos")
    .update({
      nome,
      preco,
      estoque
    })
    .eq("id", id)
    .select()

  if (error) {
    return res.status(500).json(error)
  }

  res.json(data)
})

// =============================
// DELETAR PRODUTO
// =============================

app.delete("/admin/produtos/:id", async (req, res) => {

  const { id } = req.params

  const { error } = await supabase
    .from("produtos")
    .delete()
    .eq("id", id)

  if (error) {
    return res.status(500).json(error)
  }

  res.json({ sucesso: true })
})

// =============================

app.listen(PORT, () => {
  console.log("Servidor rodando na porta", PORT)
})

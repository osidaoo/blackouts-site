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

// ======================================
// FUNÇÕES AUXILIARES
// ======================================

function gerarToken(usuario) {
  return jwt.sign(
    {
      id: usuario.id,
      papel: usuario.papel
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  )
}

function autenticarToken(req, res, next) {
  const authHeader = req.headers.authorization

  if (!authHeader) {
    return res.status(401).json({ erro: "Token não enviado" })
  }

  const token = authHeader.split(" ")[1]

  if (!token) {
    return res.status(401).json({ erro: "Token inválido" })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.usuario = decoded
    next()
  } catch (error) {
    return res.status(401).json({ erro: "Token expirado ou inválido" })
  }
}

function somenteAdmin(req, res, next) {
  if (!req.usuario || req.usuario.papel !== "admin") {
    return res.status(403).json({ erro: "Acesso permitido apenas para admin" })
  }

  next()
}

// ======================================
// TESTE
// ======================================

app.get("/", (req, res) => {
  res.json({
    status: "API Blackouts online"
  })
})

// ======================================
// LISTAR PRODUTOS PÚBLICO
// ======================================

app.get("/produtos", async (req, res) => {
  const { data, error } = await supabase
    .from("produtos")
    .select("*")
    .order("id", { ascending: true })

  if (error) {
    return res.status(500).json({ erro: error.message })
  }

  res.json(data)
})

// ======================================
// LOGIN
// ======================================

app.post("/login", async (req, res) => {
  try {
    const { email, senha } = req.body

    if (!email || !senha) {
      return res.status(400).json({ erro: "Email e senha são obrigatórios" })
    }

    const { data, error } = await supabase
      .from("Usuários")
      .select("*")
      .eq("e-mail", email)
      .single()

    if (error || !data) {
      return res.status(401).json({ erro: "Usuário não encontrado" })
    }

    const senhaValida = await bcrypt.compare(senha, data.hash_da_senha)

    if (!senhaValida) {
      return res.status(401).json({ erro: "Senha inválida" })
    }

    const token = gerarToken(data)

    res.json({
      token,
      usuario: {
        id: data.id,
        nome: data.nome,
        email: data["e-mail"],
        papel: data.papel
      }
    })
  } catch (error) {
    res.status(500).json({ erro: "Erro interno no login" })
  }
})

// ======================================
// VERIFICAR USUÁRIO LOGADO
// ======================================

app.get("/me", autenticarToken, async (req, res) => {
  res.json({
    usuario: req.usuario
  })
})

// ======================================
// LISTAR PRODUTOS ADMIN
// ======================================

app.get("/admin/produtos", autenticarToken, somenteAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from("produtos")
    .select("*")
    .order("id", { ascending: true })

  if (error) {
    return res.status(500).json({ erro: error.message })
  }

  res.json(data)
})

// ======================================
// CRIAR PRODUTO ADMIN
// ======================================

app.post("/admin/produtos", autenticarToken, somenteAdmin, async (req, res) => {
  try {
    const { nome, preco, estoque } = req.body

    if (!nome || preco === undefined || estoque === undefined) {
      return res.status(400).json({
        erro: "Nome, preço e estoque são obrigatórios"
      })
    }

    const { data, error } = await supabase
      .from("produtos")
      .insert([
        {
          nome,
          preco: Number(preco),
          estoque: Number(estoque)
        }
      ])
      .select()

    if (error) {
      return res.status(500).json({ erro: error.message })
    }

    res.json(data)
  } catch (error) {
    res.status(500).json({ erro: "Erro ao criar produto" })
  }
})

// ======================================
// ATUALIZAR PRODUTO ADMIN
// ======================================

app.put("/admin/produtos/:id", autenticarToken, somenteAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { nome, preco, estoque } = req.body

    if (!nome || preco === undefined || estoque === undefined) {
      return res.status(400).json({
        erro: "Nome, preço e estoque são obrigatórios"
      })
    }

    const { data, error } = await supabase
      .from("produtos")
      .update({
        nome,
        preco: Number(preco),
        estoque: Number(estoque)
      })
      .eq("id", id)
      .select()

    if (error) {
      return res.status(500).json({ erro: error.message })
    }

    res.json(data)
  } catch (error) {
    res.status(500).json({ erro: "Erro ao atualizar produto" })
  }
})

// ======================================
// DELETAR PRODUTO ADMIN
// ======================================

app.delete("/admin/produtos/:id", autenticarToken, somenteAdmin, async (req, res) => {
  try {
    const { id } = req.params

    const { error } = await supabase
      .from("produtos")
      .delete()
      .eq("id", id)

    if (error) {
      return res.status(500).json({ erro: error.message })
    }

    res.json({ sucesso: true })
  } catch (error) {
    res.status(500).json({ erro: "Erro ao deletar produto" })
  }
})

// ======================================

app.listen(PORT, () => {
  console.log("Servidor rodando na porta", PORT)
})

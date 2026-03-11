require("dotenv").config()

const express = require("express")
const cors = require("cors")
const bcrypt = require("bcrypt")
const jwt = require("jsonwebtoken")
const { createClient } = require("@supabase/supabase-js")

const app = express()

app.use(cors({
  origin: "*",
  methods: ["GET","POST","PUT","DELETE"],
  allowedHeaders: ["Content-Type","Authorization"]
}))

app.use(express.json())

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const PORT = process.env.PORT || 3000

// ==============================
// FUNÇÕES
// ==============================

function gerarToken(usuario){
  return jwt.sign(
    {
      id: usuario.id,
      papel: usuario.papel
    },
    process.env.JWT_SECRET,
    { expiresIn:"7d" }
  )
}

function autenticarToken(req,res,next){

  const authHeader = req.headers.authorization

  if(!authHeader){
    return res.status(401).json({erro:"Token não enviado"})
  }

  const token = authHeader.split(" ")[1]

  try{

    const decoded = jwt.verify(token,process.env.JWT_SECRET)

    req.usuario = decoded

    next()

  }catch{

    return res.status(401).json({erro:"Token inválido"})

  }
}

function somenteAdmin(req,res,next){

  if(req.usuario.papel !== "administrador"){
    return res.status(403).json({erro:"Apenas admin"})
  }

  next()
}

// ==============================
// TESTE API
// ==============================

app.get("/",(req,res)=>{

  res.json({
    status:"API Blackouts online"
  })

})

// ==============================
// PRODUTOS PUBLICO
// ==============================

app.get("/produtos",async(req,res)=>{

  const {data,error} = await supabase
  .from("produtos")
  .select("*")

  if(error){
    return res.status(500).json(error)
  }

  res.json(data)

})

// ==============================
// LOGIN
// ==============================

app.post("/login",async(req,res)=>{

  const {email,senha} = req.body

  const {data,error} = await supabase
  .from("Usuários")
  .select("*")
  .eq("e-mail",email)
  .single()

  if(!data){
    return res.status(401).json({erro:"Usuário não encontrado"})
  }

  const senhaValida = await bcrypt.compare(
    senha,
    data.hash_da_senha
  )

  if(!senhaValida){
    return res.status(401).json({erro:"Senha inválida"})
  }

  const token = gerarToken(data)

  res.json({
    token,
    usuario:{
      id:data.id,
      nome:data.nome,
      papel:data.papel
    }
  })

})

// ==============================
// PRODUTOS ADMIN
// ==============================

app.get("/admin/produtos",
autenticarToken,
somenteAdmin,
async(req,res)=>{

  const {data,error} = await supabase
  .from("produtos")
  .select("*")

  if(error){
    return res.status(500).json(error)
  }

  res.json(data)

})

// ==============================
// CRIAR PRODUTO
// ==============================

app.post("/admin/produtos",
autenticarToken,
somenteAdmin,
async(req,res)=>{

  const {nome,preco,estoque} = req.body

  const {data,error} = await supabase
  .from("produtos")
  .insert([
    {
      nome,
      preco,
      estoque
    }
  ])
  .select()

  if(error){
    return res.status(500).json(error)
  }

  res.json(data)

})

// ==============================
// ATUALIZAR PRODUTO
// ==============================

app.put("/admin/produtos/:id",
autenticarToken,
somenteAdmin,
async(req,res)=>{

  const {id} = req.params
  const {nome,preco,estoque} = req.body

  const {data,error} = await supabase
  .from("produtos")
  .update({
    nome,
    preco,
    estoque
  })
  .eq("id",id)
  .select()

  if(error){
    return res.status(500).json(error)
  }

  res.json(data)

})

// ==============================
// DELETAR PRODUTO
// ==============================

app.delete("/admin/produtos/:id",
autenticarToken,
somenteAdmin,
async(req,res)=>{

  const {id} = req.params

  const {error} = await supabase
  .from("produtos")
  .delete()
  .eq("id",id)

  if(error){
    return res.status(500).json(error)
  }

  res.json({sucesso:true})

})

// ==============================

app.listen(PORT,()=>{

  console.log("Servidor rodando na porta",PORT)

})

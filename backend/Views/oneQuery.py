from pydantic import BaseModel

class baseQuery(BaseModel):
     id:int
     Query_body:str
     User_Name:str